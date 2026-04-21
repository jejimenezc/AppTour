from weasyprint import HTML

# Contenido del README.md
readme_content = """# 🏓 TM SIEB App - Sistema de Gestión de Torneos

Este repositorio contiene la lógica de automatización para torneos de Tenis de Mesa, integrando **Google Apps Script**, **VS Code** y **Google Sheets** como motor de base de datos.

## 🏗️ Arquitectura de Datos

La aplicación utiliza un modelo relacional basado en hojas de cálculo. A continuación se detalla el diccionario de datos para la lógica del agente **Codex**:

### 1. Gestión de Jugadores y Grupos
* **Hoja `Players`**: Registro maestro. Controla el estado del jugador (`checked_in`), su clasificación inicial (`seed`) y su asignación a grupos (`group_id`). Define en qué llave jugará tras la fase inicial (`singles_bracket`: Oro, Plata, Consuelo).
* **Hoja `Groups`**: Tabla de posiciones de la fase de grupos. Almacena estadísticas de partidos jugados, ganados, sets a favor/en contra y el `rank_in_group` (1°, 2° o 3°).
* **Hoja `DoublesTeams`**: Vincula parejas de jugadores (`player_1_id`, `player_2_id`) para la modalidad de dobles.

### 2. Lógica de Competición
* **Hoja `Matches`**: El corazón del torneo. Registra cada enfrentamiento, la mesa asignada (`table_no`), los jugadores, el estado del partido y el resultado final (`sets_a`, `sets_b`).
* **Hoja `Blocks`**: Controla el flujo de tiempo del torneo. Divide la competencia en bloques (ej: "Ronda de Grupos", "Cuartos de Final") y gestiona su apertura/cierre.
* **Hoja `BracketSlots`**: Define el árbol de competencia. Mapea cómo los ganadores y perdedores avanzan de un partido a otro (`winner_to_slot`).

### 3. Sistema y Control
* **Hoja `Config`**: Parámetros globales del sistema (ej: puntos por victoria, nombres de categorías).
* **Hoja `AuditLog`**: Historial de seguridad. Registra quién hizo qué, cuándo y en qué entidad.

---

## 🚀 Flujo de Desarrollo

1.  **Edición**: Se realiza en VS Code con apoyo de IA (Codex/Copilot).
2.  **Sincronización**:
    * `clasp push`: Sube el código a Google Apps Script.
    * `git commit`: Guarda versiones en GitHub.
3.  **Pruebas**: Utilizar la URL de implementación `/dev` para testeo en tiempo real.

## 🤖 Contexto para IA (Prompt Sugerido)
> "Actúa como un experto en Google Apps Script. Mi proyecto utiliza un Spreadsheet con las hojas: Players, Groups, Matches, Blocks y BracketSlots. Los IDs de los jugadores son `player_id` y los resultados se guardan en `sets_a` y `sets_b`. Siempre valida el `status` en la hoja `Blocks` antes de ejecutar procesos de avance de fase."
"""
