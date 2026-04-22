# AppTour

## Resumen

AppTour usa una arquitectura hibrida con:

- Google Sheets como backoffice y persistencia operativa
- Google Apps Script como motor, reglas y consolidacion
- Firebase RTDB como distribucion realtime hacia clientes

La direccion actual del proyecto no es "GAS empuja todo el tiempo", sino:

- GAS publica estructura y consolida
- Firebase distribuye snapshots estructurales y eventos
- cada pantalla calcula localmente lo que puede deducir

## Aprendizajes ya cerrados

### 1. Apps Script tiene latencia estructural significativa

En pruebas reales se observo que:

- el `tick` del motor no era el mayor cuello
- el `publish` a Firebase podia costar varios segundos
- ademas habia overhead importante en:
  - `google.script.run`
  - runtime/cola de Apps Script
  - serializacion del HTML Service

Conclusion:

- Apps Script no debe ser el scheduler fino de la UX

### 2. `control heartbeat` mejora respecto del trigger, pero no resuelve timing fino

El heartbeat se uso como experimento para reemplazar el trigger automatico de 1 minuto.

Resultado:

- mejoro la latencia visible
- pero no fue suficientemente fino ni estable para dirigir la UX segundo a segundo

Conclusion:

- heartbeat queda como barrendero de estados y mecanismo de handoff estructural
- no como director de orquesta de la Publica

### 3. La Publica necesita tiempo local alineado a servidor

Cuando el cliente solo espera snapshots, la UX sufre retrasos.

Cuando el cliente proyecta tiempo local:

- la UX gana fluidez
- pero hay que alinear el reloj del cliente con referencia del servidor

Direccion vigente:

- el cliente usa snapshot base del reloj y proyecta localmente
- el contrato siguiente y ya deseado es basarse en `serverTimeOffset` / `serverNow` y un Estado de Tiempo explicito

## Arquitectura tecnica actual

## Capas

### Sheets

Contiene las tablas de negocio:

- `Players`
- `Matches`
- `Blocks`
- `Groups`
- `DoublesTeams`
- otras auxiliares

Sheets es la base consolidada para:

- fixture
- roles
- bloques
- resultados consolidados
- auditoria operativa

### Apps Script

Responsabilidades:

- motor del torneo
- reconciliacion por reloj
- progresion de dobles, grupos y singles
- consolidacion de resultados
- programacion de bloques
- publicacion de snapshots a Firebase

Funciones estables relevantes:

- `runTournamentClockTickWithOptions_()` en `firebase-live-app/clock.js`
- `getTournamentClockState_()` en `firebase-live-app/clock.js`
- `publishRealtimeSnapshotToFirebase()` en `firebase-live-app/FirebasePublisher.gs`
- `buildPartidosFirebasePayload_(publicVm)` en `firebase-live-app/FirebasePublisher.gs`
- `getPublicViewModel()` en `firebase-live-app/ui.js`
- `buildTournamentClockPayload_()` en `firebase-live-app/ui.js`
- `openSinglesGroupConfirmationWindow()` en `firebase-live-app/singles_group_confirmation.js`
- `confirmSinglesGroupsAndStartGroupStage()` en `firebase-live-app/singles_group_confirmation.js`

### Firebase RTDB

Nodos mas relevantes hoy:

- `partidos`
- `system`
- `control/heartbeatLease`
- `players/<playerId>/myDay`
- `doubles/viewModels/<playerId>`

Observacion:

- `partidos` es el nodo clave para Pantalla Publica
- `system` existe y funciona, pero no debe seguir siendo el nodo caliente de la UX

## Contratos vigentes que se conservan

### Snapshot publico

Hoy el snapshot publico se construye en GAS y se publica en Firebase.

Contiene, al menos:

- `tournamentStatus`
- `currentBlock`
- `clock`
- `matches`
- `generatedAt`
- `snapshotVersion`

Bajo el nuevo marco mental:

- este contrato sigue existiendo
- pero la tendencia es hacerlo mas liviano
- y dejar de enviar estados temporales ya resueltos

### Contrato de Estado de Tiempo

Este contrato pasa a ser la base de la nueva Publica.

La idea es separar:

- `snapshot estructural`
- `estado de tiempo`

#### Elementos esperados

El servidor debe exponer, directa o indirectamente:

- `timerStatus`
- `serverNow`
- `serverTimeOffset` o datos para calcularlo
- `currentBlock`
- `currentPhase`
- `phaseRemainingMs`
- `phases`

Ejemplo conceptual:

```json
{
  "system": {
    "currentBlock": 2,
    "currentPhase": "playing",
    "timerStatus": "running",
    "serverNow": 1779249605000,
    "phases": {
      "live": { "durationMs": 300000 },
      "closing": { "durationMs": 1200000 },
      "transition": { "durationMs": 300000 }
    },
    "phaseRemainingMs": 850000
  }
}
```

#### Regla del cliente

El cliente calcula:

- `offset = serverNow - Date.now()`
- `effectiveNow = Date.now() + offset`

Si `timerStatus === "running"`:

- proyecta el final de la fase actual
- descuenta localmente
- cambia visualmente de fase cuando el tiempo llega a cero

Si `timerStatus === "paused"`:

- muestra `phaseRemainingMs` congelado

#### Regla del servidor

El servidor actua como auditor:

- verifica periodicamente en que fase deberia estar el torneo
- corrige si el desface supera un umbral
- publica estructura nueva solo cuando cambia algo estructural

#### Umbral de resincronizacion

La correccion server-side no debe romper innecesariamente la animacion local.

Regla sugerida:

- si el desface es mayor a 5 segundos, la referencia del servidor corrige la base local

### Handoff estructural

El handoff entre bloques ya no depende de transiciones visuales publicadas continuamente.

Contrato:

- dentro del bloque, la Publica calcula localmente
- cuando cambia `currentBlock.id`, el servidor publica snapshot estructural nuevo
- la UI reinicia su base temporal y hace swap al nuevo bloque

### Tick silencioso

El motor puede avanzar sin publicar snapshot publico continuo.

Esto ya se separo en:

- tick del motor
- publish publico

El publish publico ocurre cuando hace falta, por ejemplo:

- al iniciar cronometro
- al programar estructura
- en handoff entre bloques

## Estado actual de Pantalla Publica

La Publica ya esta a medio camino en el cambio de paradigma.

Ya existe:

- reloj proyectado en cliente
- handoff estructural entre bloques
- resync al volver a foco
- monotonicidad basica de snapshots
- empty state amable

Problema aun abierto:

- la Publica todavia necesita consolidarse sobre un Contrato de Estado de Tiempo explicito
- el reloj y el bloque deben pasar a derivarse desde tiempo efectivo + fases, no desde estados temporales serializados

Direccion inmediata:

- rehacer la Publica sobre el Contrato de Estado de Tiempo
- dejar que derive estados temporales solo desde tiempos y fases
- dejar los estados duros como datos de evento en Firebase

## Ciclo de vida deseado del bloque

### UX local

- `start_ts` -> `En juego`
- `close_signal_ts` -> `Cierre en curso`
- `hard_close_ts` -> `Cerrado/Terminado`
- `end_ts` -> no visible

### Servidor

- `start_ts` -> `live`
- `close_signal_ts` -> `closing`
- `hard_close_ts` -> `transition`
- `end_ts` -> `closed`

Interpretacion:

- `closing` todavia admite resultados tardios
- `transition` ya puede mostrarse como cerrado en UX
- `closed` es la condicion para calcular/publicar el siguiente bloque

## Pausas y ventanas operativas

Una regla ya institucionalizada:

- cuando el torneo entra en `awaiting_singles_group_confirmation`, el reloj se pausa automaticamente

Motivo:

- evitar desfase entre cronometro y confirmacion manual
- permitir que los nuevos bloques de grupos/singles nazcan desde el `end_ts` del ultimo bloque terminado

## Flujo de construccion

El proyecto ahora se construye pantalla por pantalla.

Orden:

1. Pantalla Publica
2. Mi Jornada
3. Dobles
4. Control

Para cada pantalla:

1. definir que necesita renderizar
2. definir el nodo minimo de Firebase
3. separar estado temporal de estado duro
4. mover el calculo temporal al cliente
5. dejar el barrido y handoff al servidor

## Regla de continuidad para siguientes sesiones

Si en una proxima sesion se indica "lee `AGENTS.md` y `README.md`", el contexto que debe asumirse es:

- la hipotesis del heartbeat como scheduler ya esta cerrada
- estamos migrando a sincronizacion por pantalla
- el servidor publica estructura y eventos
- la Publica debe derivar tiempo localmente usando un Contrato de Estado de Tiempo
- se trabaja pantalla por pantalla, no por rediseño global abstracto
