package com.example.orderapp.ui

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.orderapp.data.OrderRepository
import com.example.orderapp.model.CartItem
import com.example.orderapp.model.Order
import com.example.orderapp.model.Product
import kotlinx.coroutines.launch

class OrderViewModel : ViewModel() {

    private val repository = OrderRepository()

    private val _products = mutableStateListOf<Product>()
    val products: List<Product> get() = _products

    val isLoadingProducts = mutableStateOf(false)
    val loadError = mutableStateOf<String?>(null)

    private val cartItems = mutableStateListOf<CartItem>()
    val cart: List<CartItem> get() = cartItems

    val customerName = mutableStateOf("")
    val notes = mutableStateOf("")

    private val orderHistory = mutableStateListOf<Order>()
    val orders: List<Order> get() = orderHistory

    val isPlacingOrder = mutableStateOf(false)
    val orderError = mutableStateOf<String?>(null)

    val cartTotal: Double get() = cartItems.sumOf { it.subtotal }
    val cartItemCount: Int get() = cartItems.sumOf { it.quantity }

    init {
        loadProducts()
    }

    fun loadProducts() {
        viewModelScope.launch {
            isLoadingProducts.value = true
            loadError.value = null
            try {
                val fetched = repository.getProducts()
                _products.clear()
                _products.addAll(fetched)
            } catch (e: Exception) {
                loadError.value = "No se pudo cargar el menú. Verifica tu conexión con el servidor."
            } finally {
                isLoadingProducts.value = false
            }
        }
    }

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

    fun placeOrder(onSuccess: (String) -> Unit) {
        if (cartItems.isEmpty()) return
        viewModelScope.launch {
            isPlacingOrder.value = true
            orderError.value = null
            try {
                val order = repository.placeOrder(
                    customerName = customerName.value.ifBlank { "Cliente" },
                    notes = notes.value,
                    items = cartItems.toList()
                )
                orderHistory.add(0, order)
                cartItems.clear()
                customerName.value = ""
                notes.value = ""
                onSuccess(order.id)
            } catch (e: Exception) {
                orderError.value = "No se pudo enviar el pedido. Intenta de nuevo."
            } finally {
                isPlacingOrder.value = false
            }
        }
    }
}
