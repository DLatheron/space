import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { App } from "./App.js";

const root = document.getElementById("root");

if (!root) {
    throw new Error("Root element not found");
}

const router = createBrowserRouter([
    {
        path: "/",
        element: <App />
    }
]);

createRoot(root).render(<RouterProvider router={router} />);
