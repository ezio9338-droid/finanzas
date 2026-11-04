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
- **Datos cifrados en el dispositivo** (AES-256), que se desbloquean con **Face ID / huella**. Ver [Seguridad](#seguridad).

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
   Los permisos que pide son: **ver y editar solo esta hoja** (no el resto de tu Drive), **ejecutarse a diario** y **enviarte emails** de aviso de seguridad.
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
4. Elige **Usar Face ID** (se crea una passkey «Hucha» en tu llavero) o una contraseña.

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
| Añadir, editar, pausar o borrar un gasto fijo | **Ajustes → Gastos fijos → ＋ Añadir**, o toca uno existente. |
| Añadir una cuenta | Edita la pestaña `Cuentas` de la hoja. La app la recoge al sincronizar. |

### Cómo se calcula el presupuesto

```
Para gastar = Nómina − Gastos fijos del ciclo − Objetivo de ahorro (% de la nómina)
```

- Los **gastos fijos** son los de la hoja `Fijos` marcados como *Cuenta en presupuesto*. Los reembolsos fijos (alguien que te paga parte de una suscripción) se restan.
- El **objetivo de ahorro** incluye la aportación al plan de pensiones.
- El **ritmo ideal** (la rayita sobre la barra) es el porcentaje del ciclo que ya ha pasado.
- Los gastos con tarjeta de crédito cuentan **el día de la compra**. El pago de la tarjeta el día 1 es una transferencia, así que no se cuenta dos veces.

### Saldos iniciales

Cada cuenta tiene un *saldo inicial* y una *fecha*. Los movimientos anteriores a esa fecha cuentan para el presupuesto y las estadísticas, pero **no cambian el saldo**, porque ya estaban incluidos en él. Así puedes apuntar gastos del ciclo que hiciste antes de empezar a usar la app.

---

## Seguridad

| Capa | Protección |
|---|---|
| **Hoja de Google** | Privada, solo accesible con tu cuenta. El script tiene permiso **solo sobre esta hoja** (`@OnlyCurrentDoc`). Google guarda el historial de versiones. |
| **API (Apps Script)** | Clave secreta aleatoria de 244 bits, comparada en tiempo constante. Rechaza peticiones mal formadas o de más de 1 MB, y solo acepta operaciones y campos conocidos. Protege contra la inyección de fórmulas. |
| **Intentos de acceso** | Cada intento con una clave incorrecta se apunta en la pestaña `Seguridad`, recibes un **email** (como máximo uno por hora) y la app te avisa. Cada respuesta fallida se retrasa 1,5 s. |
| **Transporte** | Solo HTTPS. Una política de seguridad (CSP) impide que la página se comunique con algo que no sea Google Apps Script o cargue código de terceros. |
| **Dispositivo** | Movimientos, URL y clave se guardan **cifrados con AES-256-GCM**. La llave solo existe en memoria con la app desbloqueada y se abre con una **passkey con Face ID / huella** (extensión WebAuthn PRF) o con una contraseña (PBKDF2, 600.000 iteraciones). Se bloquea sola a los **30 s** fuera de la app, y el contenido se difumina en el selector de apps. |
| **Código** | Sin dependencias externas: todo el código está en este repositorio. |

### Lo que depende de ti

- **Verificación en 2 pasos en Google** ([activar](https://myaccount.google.com/signinoptions/twosv)). Protege tu hoja.
- **Verificación en 2 pasos en GitHub** (*Settings → Password and authentication*). Evita que alguien modifique la app.
- **Código de desbloqueo en el iPhone** (lo que activa el cifrado de iOS).
- **No compartas la hoja** con nadie, y no hagas capturas en las que se vea la clave secreta.
- Si sospechas algo: en la hoja, menú **Hucha → Cambiar clave secreta**, y pon la nueva clave en la app.

Si no puedes desbloquear la app (por ejemplo, porque has cambiado de móvil), pulsa **Reconectar desde cero** y vuelve a poner la URL y la clave: todo se descarga de nuevo desde la hoja. Solo se perderían los cambios que no se hubieran sincronizado todavía.

---

## Estructura del proyecto

```
index.html, css/, js/       App web (GitHub Pages)
js/vault.js                 Cifrado local (AES-GCM + passkey PRF / PBKDF2)
js/core.js                  Lógica compartida (cálculos), la misma en la app y en Apps Script
apps-script/Code.gs         Servidor: API, automáticos diarios, resumen mensual
apps-script/Core.gs         Copia de js/core.js (tools/sync-core.sh la regenera)
sw.js, manifest.webmanifest Modo sin conexión e instalación como app
```

### Actualizar el Apps Script

Cuando una versión cambia `apps-script/Code.gs` o `apps-script/Core.gs`:

1. En el editor de Apps Script, pega el contenido nuevo de los archivos que hayan cambiado y guarda (💾).
2. Ve a **Implementar → Gestionar implementaciones**, pulsa **✏️ (editar)**, en **Versión** elige **Nueva versión** y pulsa **Implementar**.

⚠️ No uses "Nueva implementación", porque eso crearía otra URL. Si editas la implementación existente, la URL se mantiene y no hay que tocar nada en la app.

**Al actualizar la app:** si cambia `js/core.js`, hay que pegar el nuevo `Core.gs` en Apps Script y publicar una versión nueva: **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva**. La URL no cambia.
