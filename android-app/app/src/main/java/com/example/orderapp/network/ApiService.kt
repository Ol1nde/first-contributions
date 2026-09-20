package com.example.orderapp.network

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface ApiService {
    @GET("api/products")
    suspend fun getProducts(): List<ProductDto>

    @POST("api/orders")
    suspend fun createOrder(@Body request: CreateOrderRequest): OrderDto
}
