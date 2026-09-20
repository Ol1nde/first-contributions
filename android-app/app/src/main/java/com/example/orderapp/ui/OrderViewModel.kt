package com.example.orderapp.ui

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import com.example.orderapp.data.ProductCatalog
import com.example.orderapp.model.CartItem
import com.example.orderapp.model.Order
import com.example.orderapp.model.Product
import java.time.LocalDateTime
import java.util.UUID

class OrderViewModel : ViewModel() {

    val products = ProductCatalog.products

    private val cartItems = mutableStateListOf<CartItem>()
    val cart: List<CartItem> get() = cartItems

    val customerName = mutableStateOf("")
    val notes = mutableStateOf("")

    private val orderHistory = mutableStateListOf<Order>()
    val orders: List<Order> get() = orderHistory

    val cartTotal: Double get() = cartItems.sumOf { it.subtotal }
    val cartItemCount: Int get() = cartItems.sumOf { it.quantity }

    fun addToCart(product: Product) {
        val index = cartItems.indexOfFirst { it.product.id == product.id }
        if (index >= 0) {
            val existing = cartItems[index]
            cartItems[index] = existing.copy(quantity = existing.quantity + 1)
        } else {
            cartItems.add(CartItem(product, 1))
        }
    }

    fun decreaseQuantity(product: Product) {
        val index = cartItems.indexOfFirst { it.product.id == product.id }
        if (index < 0) return
        val existing = cartItems[index]
        if (existing.quantity <= 1) {
            cartItems.removeAt(index)
        } else {
            cartItems[index] = existing.copy(quantity = existing.quantity - 1)
        }
    }

    fun removeFromCart(product: Product) {
        cartItems.removeAll { it.product.id == product.id }
    }

    fun placeOrder(): Order? {
        if (cartItems.isEmpty()) return null
        val order = Order(
            id = UUID.randomUUID().toString().take(8).uppercase(),
            customerName = customerName.value.ifBlank { "Cliente" },
            notes = notes.value,
            items = cartItems.toList(),
            placedAt = LocalDateTime.now()
        )
        orderHistory.add(0, order)
        cartItems.clear()
        customerName.value = ""
        notes.value = ""
        return order
    }
}
