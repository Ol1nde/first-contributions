package com.example.orderapp.network

data class ProductDto(
    val id: String,
    val name: String,
    val description: String,
    val price: Double,
    val emoji: String
)

data class CreateOrderItemRequest(
    val productId: String,
    val quantity: Int
)

data class CreateOrderRequest(
    val customerName: String,
    val notes: String,
    val items: List<CreateOrderItemRequest>
)

data class OrderItemDto(
    val productId: String,
    val productName: String,
    val unitPrice: Double,
    val quantity: Int
)

data class OrderDto(
    val id: String,
    val customerName: String,
    val notes: String,
    val status: String,
    val total: Double,
    val placedAt: String,
    val items: List<OrderItemDto>
)
