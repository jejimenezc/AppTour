# AGENTS

## Identidad del proyecto

Este repositorio ya cerro la hipotesis de "`control heartbeat` como scheduler fino del torneo".

La arquitectura de trabajo vigente es:

- `Sincronizacion por Pantalla`
- `Barrendero de Estados`

Eso significa:

- la UI no debe esperar que Apps Script marque cada transicion visual
- Firebase RTDB distribuye estructura y eventos relevantes
- cada pantalla calcula localmente lo que pueda deducir por tiempo
- Apps Script barre, consolida, recalcula y publica cambios estructurales

## Hipotesis cerradas

Estas decisiones ya no se discuten como direccion principal:

- Apps Script + `google.script.run` no se considera un scheduler fino y confiable para dirigir la UX segundo a segundo
- `control heartbeat` no es el "director de orquesta" de la Publica
- el trigger automatico de Apps Script no sirve como mecanismo fino de tiempo real

`control heartbeat` y los ticks del servidor siguen existiendo, pero su rol es:

- avanzar el motor
- consolidar estado
- hacer handoff estructural entre bloques
- actuar como barrendero de estados

## Regla central: Estado Temporal vs Estado Duro

### Estado Temporal

Es cualquier estado deducible solo desde reloj + hitos del bloque.

Ejemplos:

- `scheduled`
- `live`
- `closing`
- `transition`
- `closed`
- labels visuales como `Programado`, `En juego`, `Cierre en curso`, `Cerrado/Terminado`

Regla:

- no debe viajar como verdad autoritativa en el JSON publico
- el cliente lo deduce con funciones tipo `getBlockVisualState(now, blockWindow)`
- el calculo ocurre localmente y se reevalua cada segundo

### Estado Duro

Es cualquier decision que el reloj no puede adivinar.

Ejemplos:

- resultado ingresado
- walkover
- mesa bloqueada
- necesita revision
- cierre administrativo
- notas o decisiones humanas

Regla:

- si debe viajar en Firebase
- si debe persistirse y consolidarse
- el cliente lo consume como evento o bandera, no lo inventa

## Regla del snapshot

Para Pantalla Publica, el snapshot debe ser lo mas liviano posible.

Debe privilegiar:

- identidad del bloque
- hitos temporales del bloque
- participantes y mesas
- eventos duros por partido
- informacion minima para render

Debe evitar:

- estados temporales ya resueltos por el servidor
- campos administrativos no visibles
- estructuras historicas innecesarias
- payloads de debug

## Regla de la Publica

La Pantalla Publica debe operar con este contrato mental:

- `snapshot` = estructura
- `reloj local` = estado temporal visible

La Publica no debe depender de republishes periodicos para:

- `Programado -> En juego`
- `En juego -> Cierre en curso`
- `Cierre en curso -> Cerrado/Terminado`

Solo necesita snapshot nuevo cuando cambia algo estructural:

- programacion inicial
- inicio del cronometro
- handoff a otro bloque
- cambio de mesas/partidos
- eventos duros visibles

## Regla del handoff

Entre bloques manda el servidor.

Dentro del bloque manda el calculo local.

Definicion:

- mientras un bloque esta activo, la Publica lo recorre localmente
- cuando el servidor decide que el siguiente bloque ya esta listo, publica un nuevo snapshot estructural
- la UI hace swap de bloque por `blockId`, no por una cadena de estados intermedios

## Regla del reloj

El reloj visible en cliente debe usar referencia de servidor, no depender del reloj crudo del telefono.

Marco institucionalizado:

- la estructura del bloque y el estado del tiempo son contratos distintos
- el cliente anima el segundero
- el servidor entrega la referencia de tiempo y audita desfases
- `snapshotVersion` sirve para frescura estructural
- `serverNow` es el ancla fresca del contrato de tiempo
- el cliente calcula `offset = serverNowMs - Date.now()`
- el cliente calcula `effectiveNow = Date.now() + offset`

Regla operativa ya validada en Publica:

- si `timerStatus === "running"`, el cliente proyecta el acumulado desde:
  - `baseElapsedMs + (effectiveNowMs - serverNowMs)`
- si `timerStatus === "paused"`, el cliente conserva `baseElapsedMs`
- el cronometro visible debe renderizarse como:
  - `internalNowMs - tournamentStartMs`
- no debe renderizarse como countdown de fase

## Contrato de Estado de Tiempo

Este contrato ya debe considerarse la direccion oficial para la Publica y para las siguientes pantallas que dependan de tiempo.

### Objetivo

Separar:

- estructura del bloque
- eventos duros
- estado del tiempo

La UI no debe depender de republishes de estado temporal. La UI debe poder recorrer localmente las fases del bloque usando un reloj efectivo alineado a servidor.

### Componentes del contrato

El servidor publica:

- `timerStatus`
- `serverNow`
- `currentBlock`
- `currentPhase`
- `phaseRemainingMs`
- `tournamentStartMs`
- `tournamentElapsedMs`
- `pausedAccumulatedMs`
- `phases` o el mapa equivalente de duraciones y orden

El cliente calcula:

- `effectiveNow = Date.now() + offset`
- el fin de la fase actual
- la transicion visual a la siguiente fase cuando corresponda

### Regla de autonomia del cliente

Si `timerStatus === "running"`:

- el cliente proyecta localmente el tiempo acumulado del torneo
- el cliente descuenta localmente el tiempo restante de fase
- si la fase llega a cero, avanza visualmente a la siguiente fase del bloque

Si `timerStatus === "paused"`:

- el cliente muestra el tiempo congelado
- no avanza de fase

### Regla de auditoria del servidor

El servidor no necesita dirigir cada segundo de la UX.

Su rol es:

- verificar en ciclos lentos en que fase deberia estar el torneo
- corregir discrepancias significativas
- publicar cambios estructurales o correcciones temporales cuando haga falta

### Regla de resincronizacion

El tiempo del servidor sobrescribe al tiempo local solo cuando la diferencia supera un umbral razonable.

Ejemplo:

- si el desfase es mayor a 5 segundos, el cliente se corrige

### Regla de aplicacion

Para Pantalla Publica:

- el bloque es una secuencia ordenada de fases
- la App calcula visualmente `scheduled/live/closing/transition/closed`
- el JSON no debe transportar esos estados temporales resueltos

### Estado actual

La Pantalla Publica ya quedo estabilizada bajo este contrato.

Eso incluye:

- cronometro lineal sincronizado entre pantallas y dispositivos
- `start/pause/resume` funcionando sobre `timeState`
- transiciones de bloque/fase calculadas localmente
- header y render publico consumiendo la misma proyeccion temporal
- handoff estructural manteniendo el bloque como frontera de publicacion

Por lo tanto, este contrato deja de ser solo una direccion futura y pasa a ser referencia operativa para las siguientes pantallas.

## Regla del nodo publico

El nodo publico debe quedar modelado como:

- estructura del bloque
- eventos duros por partido
- contrato de tiempo para la fase actual

No como:

- mezcla de estructura + estado temporal ya resuelto por servidor

## Regla de Firebase

Firebase no es solo espejo de estados calculados por GAS.

Para cada pantalla, Firebase debe modelarse desde la necesidad de esa pantalla:

- estructura minima
- eventos duros
- tiempos necesarios para deduccion local

No se preserva compatibilidad por si misma con contratos anteriores si eso estorba a la nueva arquitectura.

## Reglas que han resultado efectivas

- separar tick del motor y publish publico
- publicar snapshots estructurales solo cuando hace falta
- tratar `transition` como estado de consolidacion server-side y `Cerrado/Terminado` en UX
- pausar automaticamente el reloj cuando el torneo entra en `awaiting_singles_group_confirmation`
- mover trafico caliente fuera de `system` cuando sea posible

## Orden de construccion

La app se rehace pantalla por pantalla, de abajo hacia arriba:

1. Pantalla Publica
2. Mi Jornada
3. Dobles
4. Control

La regla es:

- primero definir que necesita brillar esa pantalla
- luego definir el nodo minimo de Firebase
- despues definir el calculo local y el barrido server-side

## Prohibiciones practicas

- no volver a tratar heartbeat como scheduler fino de UX
- no reintroducir estados temporales completos en snapshots solo "por compatibilidad"
- no hinchar el nodo publico con datos de control o historia si la pantalla no los necesita
- no confiar en Apps Script para exactitud segundo a segundo de render

## Punto actual

Estamos en la etapa de consolidar la nueva arquitectura para Pantalla Publica:

- handoff estructural entre bloques ya existe
- el reloj local ya se proyecta en cliente
- hay protecciones de monotonicidad para snapshots
- el siguiente salto conceptual es formalizar el Contrato de Estado de Tiempo y rehacer la Publica sobre esa base
