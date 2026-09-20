package com.example.orderapp.data

import com.example.orderapp.model.Product

object ProductCatalog {
    val products = listOf(
        Product("1", "Hamburguesa clásica", "Carne, lechuga, tomate y queso", 8.50, "🍔"),
        Product("2", "Pizza margarita", "Tomate, mozzarella y albahaca", 10.90, "🍕"),
        Product("3", "Ensalada César", "Pollo, lechuga, crutones y parmesano", 7.20, "🥗"),
        Product("4", "Tacos al pastor", "Tres tacos con piña y cilantro", 9.00, "🌮"),
        Product("5", "Refresco", "Botella 500ml", 2.00, "🥤"),
        Product("6", "Papas fritas", "Porción grande con sal", 3.50, "🍟"),
        Product("7", "Helado", "Vainilla, chocolate o fresa", 4.00, "🍨"),
        Product("8", "Café", "Espresso o americano", 2.50, "☕")
    )
}
