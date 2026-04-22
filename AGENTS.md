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

Marco vigente:

- el snapshot entrega base temporal del torneo
- el cliente proyecta localmente
- el siguiente paso deseado es usar `serverTimeOffset` para alinear mejor el tiempo local con el tiempo del servidor

`snapshotVersion` sigue siendo util para frescura estructural, no para calcular el reloj.

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
- usar burst corto de refuerzo en momentos estructurales criticos
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
- existen republishes cortos de refuerzo en momentos estructurales
- el siguiente salto conceptual es abandonar el enfoque hibrido y calcular estado temporal solo desde tiempos

