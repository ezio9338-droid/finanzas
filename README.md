# Hucha 🐷

App web (PWA) de finanzas personales para iPhone y PC. Usa Google Sheets como base de datos.

- Saldo de cada cuenta: bancos, metálico, *pockets*, ahorro, inversión, plan de pensiones y tarjetas de crédito.
- Botones para apuntar **gastos, ingresos y transferencias**.
- **Redondeo automático** de la tarjeta de débito: hasta el euro siguiente × 5 (5 € si el importe es exacto).
- **Ciclos de nómina a nómina**, con una barra de presupuesto mensual que marca el ritmo ideal de gasto.
- **Presupuesto calculado a partir de tu objetivo de ahorro**: nómina − gastos fijos − ahorro = lo que puedes gastar.
- **Gastos fijos automáticos**: mensuales, cada N días, con un número de pagos limitado y pago de la tarjeta de crédito.
- **Intereses netos diarios** de la cuenta remunerada, a partir de la TAE y la retención.
- **Gastos compartidos**: solo cuenta tu parte, y la lista "Me deben" se va saldando con los Bizum que recibes.
- **Asistente de nómina**: reparte el sobrante entre inversión y remunerada (30/70) y te propone los traspasos.
- **Estadísticas**: gasto por categoría, ingresos y gastos por ciclo, tasa de ahorro y patrimonio.
- Funciona **sin conexión** y sincroniza al volver la cobertura.
- **PIN** al abrir, y **clave secreta** entre la app y la hoja.

> 🔒 Este repositorio es público, pero **solo contiene el código**. Tus movimientos y saldos están en tu hoja de Google y en tu móvil, nunca aquí.

---

## Instalación (una sola vez, mejor desde el PC)

### 1. Crea la hoja de cálculo

1. Entra en [sheets.new](https://sheets.new) y crea una hoja en blanco. Ponle de nombre, por ejemplo, `Hucha`.
2. En el menú, ve a **Extensiones → Apps Script**.

### 2. Pega el código

En el editor de Apps Script:

1. Borra lo que haya en `Código.gs` y pega el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
2. Crea otro archivo con **＋ → Secuencia de comandos**, llámalo `Core` y pega [`apps-script/Core.gs`](apps-script/Core.gs).
3. *(Opcional)* Crea otro archivo llamado `Datos` y pega tu `Datos.gs` privado, con tus cuentas, saldos y gastos fijos. Este archivo **no está en el repositorio**. Si no lo pegas, se crea una plantilla vacía que puedes rellenar directamente en la hoja.
4. Ve a **⚙ Configuración del proyecto** y elige la zona horaria **Europe/Madrid**.
5. Pulsa 💾 para guardar.

### 3. Ejecuta la instalación

1. Arriba, en el desplegable de funciones, elige **`instalar`** y pulsa **▶ Ejecutar**.
2. Google te pedirá permisos: **Revisar permisos → tu cuenta → Configuración avanzada → Ir a Hucha (no seguro) → Permitir**. Te avisa porque el script es tuyo y no está verificado por Google, es normal.
3. Al terminar, la hoja tendrá las pestañas `Movimientos`, `Cuentas`, `Categorias`, `Fijos`, `Config` y `Resumen`, y te mostrará tu **clave secreta**. Puedes volver a verla desde el menú **Hucha → Ver clave secreta** de la hoja.

### 4. Publica la API

1. Ve a **Implementar → Nueva implementación**, pulsa ⚙ y elige **Aplicación web**.
2. Configúrala así:
   - **Ejecutar como:** Yo
   - **Quién tiene acceso:** Cualquier usuario
3. Pulsa **Implementar** y copia la **URL**. Termina en `/exec`.

> "Cualquier usuario" significa que la URL responde a cualquiera, pero sin la clave secreta no devuelve ni guarda nada.

### 5. Instala la app en el iPhone

1. Abre en **Safari** la dirección de la app: **https://ezio9338-droid.github.io/finanzas/**
2. Pulsa **Compartir → Añadir a pantalla de inicio**.
3. Abre Hucha desde el icono, pega la **URL** y la **clave secreta**, y pulsa **Conectar**.
4. Si quieres, activa un **PIN**.

En el PC puedes usar la misma dirección en cualquier navegador.

---

## Uso diario

| Quiero… | Cómo |
|---|---|
| Apuntar un gasto | **＋** → importe → categoría → Guardar. Si pagas con la débito, el redondeo a Mac se apunta solo. |
| Una cena que me pagarán | Activa **Compartido** y pon **tu parte**. Cuando llegue el Bizum, pulsa **Cobrado** en "Me deben". |
| Cobrar la nómina | **＋ → Ingreso → Es la nómina**. Empieza un ciclo nuevo y se abre el asistente de reparto. |
| Pasar dinero entre cuentas | **＋ → Transferencia**. |
| Corregir un saldo | Toca la cuenta → escribe el saldo real → **Ajustar**. |
| Editar o borrar | Toca el movimiento en la lista. |
| Cambiar el % de ahorro o los presupuestos | **Ajustes**. |
| Añadir un gasto fijo o una cuenta | Edita las pestañas `Fijos` o `Cuentas` de la hoja. La app lo recoge al sincronizar. |

### Cómo se calcula el presupuesto

```
Para gastar = Nómina − Gastos fijos del ciclo − Objetivo de ahorro (% de la nómina)
```

- Los **gastos fijos** son los de la hoja `Fijos` marcados como *Cuenta en presupuesto*. Los reembolsos fijos, como lo que te pagan tus hermanos por Spotify, se restan.
- El **objetivo de ahorro** incluye la aportación al plan de pensiones.
- El **ritmo ideal** (la rayita sobre la barra) es el porcentaje del ciclo que ya ha pasado.
- Los gastos con tarjeta de crédito cuentan **el día de la compra**. El pago de la tarjeta el día 1 es una transferencia, así que no se cuenta dos veces.

### Saldos iniciales

Cada cuenta tiene un *saldo inicial* y una *fecha*. Los movimientos anteriores a esa fecha cuentan para el presupuesto y las estadísticas, pero **no cambian el saldo**, porque ya estaban incluidos en él. Así puedes apuntar gastos del ciclo que hiciste antes de empezar a usar la app.

---

## Estructura del proyecto

```
index.html, css/, js/       App web (GitHub Pages)
js/core.js                  Lógica compartida (cálculos), la misma en la app y en Apps Script
apps-script/Code.gs         Servidor: API, automáticos diarios, resumen mensual
apps-script/Core.gs         Copia de js/core.js (tools/sync-core.sh la regenera)
sw.js, manifest.webmanifest Modo sin conexión e instalación como app
```

**Al actualizar la app:** si cambia `js/core.js`, hay que pegar el nuevo `Core.gs` en Apps Script y publicar una versión nueva: **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva**. La URL no cambia.
