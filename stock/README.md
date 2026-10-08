# Cálculo de stock mínimo y máximo

`calcular_stock.py` lee un listado de ventas por artículo y cliente y genera un Excel con el stock recomendado.

## Reglas

| Regla | Valor por defecto |
|---|---|
| Periodo | Últimos 12 meses con ventas (o un año natural con `--año`) |
| Stock mínimo | 1 mes de venta media (`uds del periodo / 12`), redondeado hacia arriba |
| Stock máximo | 2 meses de venta media, redondeado hacia arriba |
| Referencias que se mantienen | Compradas por **5 clientes distintos o más** (cliente = Código + Centro) |
| Referencias a quitar | Menos de 5 clientes, o sin ventas en el periodo |

## Listado de entrada

Excel (`.xlsx`/`.xls`) o CSV con las columnas habituales del ERP:
`Año, Cliente, Centro, Nombre, Familia, Artículo, Descripción artículo, Enero … Diciembre, Anual`.

`Cliente` y `Artículo` son obligatorias. Hacen falta los 12 meses o la columna `Anual`. Los nombres se reconocen sin distinguir mayúsculas ni tildes, y los meses también en abreviatura (`Ene`, `Feb`…).

## Uso

```bash
pip install pandas openpyxl
python3 calcular_stock.py ventas.xlsx                  # últimos 12 meses
python3 calcular_stock.py ventas.xlsx --año 2025       # año natural
python3 calcular_stock.py ventas.xlsx --min-clientes 5 --meses-min 1 --meses-max 2 -o stock.xlsx
```

## Excel generado

- **Stock**: referencias que se mantienen, con nº de clientes, unidades, media mensual, stock mínimo y máximo. Si rellenas la columna amarilla *Stock actual*, la hoja calcula *A pedir* (hasta el máximo cuando estás por debajo del mínimo) y el *Estado* (Bajo mínimo / OK / Exceso).
- **Referencias a quitar**: referencias que no cumplen los requisitos, con el motivo.
- **Resumen**: criterios aplicados y totales.
