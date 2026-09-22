package com.example.orderapp.data

import com.example.orderapp.model.CartItem
import com.example.orderapp.model.Order
import com.example.orderapp.model.Product
import com.example.orderapp.network.CreateOrderItemRequest
import com.example.orderapp.network.CreateOrderRequest
import com.example.orderapp.network.NetworkModule
import java.time.LocalDateTime

class OrderRepository {

    private val api = NetworkModule.apiService

    suspend fun getProducts(): List<Product> =
        api.getProducts().map { Product(it.id, it.name, it.description, it.price, it.emoji) }

    suspend fun placeOrder(customerName: String, notes: String, items: List<CartItem>): Order {
        val request = CreateOrderRequest(
            customerName = customerName,
            notes = notes,
            items = items.map { CreateOrderItemRequest(it.product.id, it.quantity) }
        )
        val response = api.createOrder(request)
        return Order(
            id = response.id,
            customerName = response.customerName,
            notes = response.notes,
            items = items,
            placedAt = LocalDateTime.now()
        )
    }
}
