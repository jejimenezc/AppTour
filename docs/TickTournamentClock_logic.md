Propósito general de tickTournamentClock()

tickTournamentClock() es el orquestador temporal del torneo.
Su trabajo es:

mirar el bloque actual (current_block_id)
comparar la hora actual con los hitos del bloque
mover el bloque por su ciclo de estados
disparar efectos secundarios sobre:
matches
roles de jugadores
progresión de fases del torneo

La secuencia de estados del bloque que implementamos es:

scheduled
live
closing
transition
closed
1. Fuente de verdad temporal

Cada bloque tiene estos timestamps:

start_ts
close_signal_ts
hard_close_ts
end_ts

Y el bloque actual se obtiene desde:

Config.current_block_id
luego getCurrentBlock()
2. Lógica principal de tickTournamentClock()
A. scheduled -> live

Condición:

status === 'scheduled'
now >= start_ts
now < close_signal_ts

Acción:

llama startCurrentBlock(blockId)
Efectos de startCurrentBlock
actualiza el bloque a status = 'live'
registra published_at = nowIso()
llama markMatchesAsLive(blockId)
llama syncPlayerRolesForBlock(blockId)
Intención funcional

En este punto el bloque ya empezó.
Los partidos asignados a ese bloque dejan de ser “futuros” a nivel operativo y los jugadores reciben rol actual:

play
referee
idle
B. live -> closing

Condición:

status === 'live'
now >= close_signal_ts
now < hard_close_ts

Acción:

llama enterClosingState(blockId)
Efectos
actualiza el bloque a status = 'closing'
Intención funcional

Es la señal de cierre suave del bloque.
Todavía puede haber partidos no finalizados, pero el sistema entra en fase de cierre.

C. live/closing -> transition

Condición:

status === 'live' || status === 'closing'
now >= hard_close_ts
now < end_ts

Acción:

llama enterTransitionState(blockId)
Efectos de enterTransitionState
finalizePendingMatchesAtHardClose(blockId)
fuerza resolución/cierre de partidos pendientes según la lógica de hard close
si block.phase_type === 'groups'
llama recomputeGroupStandings()
actualiza el bloque:
status = 'transition'
advance_done = true
llama syncPlayerRolesForNoActiveBlock()
deja a todos en idle
Intención funcional

Este es el paso clave entre “se acabó el bloque operativo” y “ahora se puede avanzar la fase”.

Para grupos, aquí se recalculan standings y ranks.
Esto es importante porque si este paso se salta, la fase siguiente puede romperse.

D. transition -> closed

Condición:

status === 'transition'
now >= end_ts

Acción:

llama finishCurrentBlockAndMoveNext(blockId)
Intención funcional

Cierra definitivamente el bloque y decide cuál es el siguiente paso del torneo.

3. Lógica de finishCurrentBlockAndMoveNext(blockId)

Esta función hace dos cosas:

cierra el bloque actual
intenta activar el siguiente bloque o avanzar la fase del torneo
Paso inicial

Siempre hace:

closeBlock(blockId)

Luego intenta:

activateNextBlock()

Si existe un siguiente bloque ya creado y programado:

lo activa como bloque actual
ajusta tournament_status según phase_type

Estados usados:

running_doubles
running_groups
running_singles_knockout
4. Lógica por fase si no existe bloque siguiente

Si activateNextBlock() no encuentra un siguiente bloque, entonces depende del phase_type del bloque recién cerrado.

A. Si el bloque era doubles y NO era la final de dobles

Acción:

llama progressDoublesOneRound()
Si crea nuevo bloque
actualiza current_block_id
tournament_status = running_doubles
Si ya no hay más rondas preliminares y la final quedó reservada
limpia current_block_id = ''
pone:
tournament_status = awaiting_doubles_final
inmediatamente abre la ventana de grupos:
openSinglesGroupConfirmationWindow()

Ojo: esta función después deja:

tournament_status = awaiting_singles_group_confirmation
Intención funcional

Dobles preliminar termina, la final queda reservada, y se abre el checkpoint de grupos.

B. Si el bloque era groups

Acción:

verifica areAllGroupMatchesResolved()
si sí:
llama setupSinglesEliminationStage()
busca el primer/último bloque de singles generado
actualiza current_block_id
tournament_status = running_singles_knockout
Intención funcional

Cuando grupos termina completamente, se generan las llaves de singles y se arranca knockout.

Punto crítico

setupSinglesEliminationStage() asume que:

los standings ya fueron recomputados
Players.group_rank ya está completo

Eso depende de que enterTransitionState() haya corrido correctamente en bloques de groups.

C. Si el bloque era singles y NO era bloque final de singles

Acción:

llama markGoldFinalistsIfApplicable()
llama progressSinglesBracketsOneRound()
Si crea nuevo bloque
actualiza current_block_id
tournament_status = running_singles_knockout
Si ya no hay más rondas preliminares y las finales quedaron reservadas
limpia current_block_id = ''
pone:
tournament_status = awaiting_singles_final
Intención funcional

Las llaves preliminares de oro/plata/cobre avanzan hasta dejar reservadas sus finales.

D. Si el bloque era la final de dobles

Acción:

verifica isDoublesFinalResolved()
Si está resuelta
intenta crear el bloque de finales de singles:
createSinglesFinalsBlockIfNeeded()
si se crea, ese bloque pasa a ser el actual
si no:
limpia current_block_id = ''
tournament_status = awaiting_singles_final
Intención funcional

Después de la final de dobles, vienen las finales de singles.

E. Si el bloque era el bloque final de singles

Acción:

verifica areAllSinglesFinalsResolved()
Si sí
limpia current_block_id = ''
tournament_status = finished
Si no
limpia current_block_id = ''
tournament_status = running_finals
Intención funcional

Cerrar definitivamente el torneo.

5. Efecto sobre los partidos (Matches)
Lo que debería pasar conceptualmente
Cuando el bloque pasa a live

startCurrentBlock() llama:

markMatchesAsLive(blockId)

La intención es que los matches del bloque dejen el estado puramente programado y pasen a un estado activo/coherente con bloque en curso.

Cuando el bloque pasa a transition

enterTransitionState() llama:

finalizePendingMatchesAtHardClose(blockId)

La intención es que los partidos no resueltos no queden colgados al terminar el bloque.

Cuando se reporta resultado explícito

Los matches pueden quedar, por ejemplo, en:

status = result_submitted
result_mode = final
o
status = result_submitted
result_mode = closing_state
6. Efecto sobre roles de jugadores (Players.current_role)
Al iniciar bloque (live)

syncPlayerRolesForBlock(blockId) asigna:

play a player_a y player_b
referee a referee_player_id
idle al resto
Al pasar a transition

syncPlayerRolesForNoActiveBlock() deja a todos:

idle
7. Estados del torneo (Config.tournament_status) que usa esta lógica

Dependiendo del punto del flujo, puede quedar en:

awaiting_doubles_confirmation
running_doubles
awaiting_doubles_final
awaiting_singles_group_confirmation
running_groups
running_singles_knockout
awaiting_singles_final
running_finals
finished
8