package com.example.orderapp.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun OrderConfirmationScreen(
    viewModel: OrderViewModel,
    orderId: String,
    onBackToMenu: () -> Unit
) {
    val order = viewModel.orders.firstOrNull { it.id == orderId }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text("¡Pedido confirmado!", style = MaterialTheme.typography.headlineSmall)
            Spacer(modifier = Modifier.height(8.dp))
            Text("Número de pedido: $orderId")
            if (order != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text("Total: €%.2f".format(order.total))
            }
            Spacer(modifier = Modifier.height(24.dp))
            Button(onClick = onBackToMenu) {
                Text("Volver al menú")
            }
        }
    }
}
