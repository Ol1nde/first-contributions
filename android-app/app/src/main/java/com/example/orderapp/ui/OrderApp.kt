package com.example.orderapp.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

private object Routes {
    const val MENU = "menu"
    const val CART = "cart"
    const val CONFIRMATION = "confirmation/{orderId}"
    fun confirmation(orderId: String) = "confirmation/$orderId"
}

@Composable
fun OrderApp(viewModel: OrderViewModel = viewModel()) {
    val navController: NavHostController = rememberNavController()

    NavHost(navController = navController, startDestination = Routes.MENU) {
        composable(Routes.MENU) {
            MenuScreen(
                viewModel = viewModel,
                onGoToCart = { navController.navigate(Routes.CART) }
            )
        }
        composable(Routes.CART) {
            CartScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onOrderPlaced = { orderId ->
                    navController.navigate(Routes.confirmation(orderId)) {
                        popUpTo(Routes.MENU)
                    }
                }
            )
        }
        composable(
            route = Routes.CONFIRMATION,
            arguments = listOf(navArgument("orderId") { type = NavType.StringType })
        ) { backStackEntry ->
            val orderId = backStackEntry.arguments?.getString("orderId") ?: ""
            OrderConfirmationScreen(
                viewModel = viewModel,
                orderId = orderId,
                onBackToMenu = {
                    navController.navigate(Routes.MENU) {
                        popUpTo(Routes.MENU) { inclusive = true }
                    }
                }
            )
        }
    }
}
