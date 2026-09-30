import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { PlanetPage } from "./pages/PlanetPage.js";

const root = document.getElementById("root");

if (!root) {
    throw new Error("Root element not found");
}

// Game routes nest under App so the socket and HexWorld survive navigation.
const router = createBrowserRouter([
    {
        path: "/",
        element: <App />,
        children: [
            {
                path: "location/:locationId",
                element: <PlanetPage />
            }
        ]
    }
]);

createRoot(root).render(<RouterProvider router={router} />);
