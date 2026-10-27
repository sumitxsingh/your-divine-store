
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import App from "./App.jsx";
import Admin from "./pages/Admin.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />

        {/* Admin login */}
        <Route path="/admin/login" element={<Admin />} />

        {/* Admin dashboard / login fallback */}
        <Route path="/admin" element={<Admin />} />

        {/* Unknown URLs return to the store */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
