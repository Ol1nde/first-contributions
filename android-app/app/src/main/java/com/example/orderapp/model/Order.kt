package com.example.orderapp.model

import java.time.LocalDateTime

data class Order(
    val id: String,
    val customerName: String,
    val notes: String,
    val items: List<CartItem>,
    val placedAt: LocalDateTime
) {
    val total: Double get() = items.sumOf { it.subtotal }
}
