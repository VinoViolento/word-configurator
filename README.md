# word-configurator

Herramientas para la preparación de propuestas de sistemas de control DeltaV:

- **`taskpane.*`** — add-in de Word (panel de tareas) que sincroniza datos del proyecto con la plantilla de propuesta.
- **`costing/`** — modelo matemático de costeo de horas de servicios (oficina / taller / sitio). Ver [`costing/README.md`](costing/README.md) y la formulación en [`docs/modelo-costeo-horas.md`](docs/modelo-costeo-horas.md).

```bash
node costing/test/test.js                                  # pruebas
node costing/cli.js costing/ejemplos/planta-nueva.json     # reporte de ejemplo
```
