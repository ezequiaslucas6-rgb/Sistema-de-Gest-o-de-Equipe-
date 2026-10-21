import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import "./base.css";
import "./global.css";
import { GlobalContextProviders } from "./components/_globalContextProviders";
import { AuthGate } from "./components/AuthGate";
import { AppShell } from "./components/AppShell";
import DashboardPage from "./pages/_index";
import SchedulePage from "./pages/escala";
import OnCallPage from "./pages/plantao";
import HolidaysPage from "./pages/feriados";
import PlanningPage from "./pages/planejamento";
import TeamsPage from "./pages/equipes";
import AbsencesPage from "./pages/ausencias";

const pages = [
  { path: "/", element: <DashboardPage /> },
  { path: "/escala", element: <SchedulePage /> },
  { path: "/plantao", element: <OnCallPage /> },
  { path: "/feriados", element: <HolidaysPage /> },
  { path: "/planejamento", element: <PlanningPage /> },
  { path: "/equipes", element: <TeamsPage /> },
  { path: "/ausencias", element: <AbsencesPage /> },
];

// HashRouter: as rotas ficam depois do "#", o que funciona no GitHub Pages sem configuração extra
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <GlobalContextProviders>
        <AuthGate>
          <Routes>
            {pages.map((p) => (
              <Route key={p.path} path={p.path} element={<AppShell>{p.element}</AppShell>} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthGate>
      </GlobalContextProviders>
    </HashRouter>
  </StrictMode>,
);
