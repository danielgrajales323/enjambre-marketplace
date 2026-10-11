---
description: Pedir la instalación "sin escribir nada" tiene que terminar en un init con --dry-run y sin crear .enjambre/. Necesita `--allow-tools Bash` al correr el eval (Bash no está disponible por defecto).
tags: [init]
runs: 2
max_turns: 8
allowed_tools: [Read, Glob, Bash]
---

Quiero ver qué haría el enjambre si lo instalo en este proyecto, pero sin escribir nada todavía. Mostrame el plan.
