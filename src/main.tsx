import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import "./base.css";
import "./global.css";
import { GlobalContextProviders } from "./components/_globalContextProviders";
import { AppShell } from "./components/AppShell";
import { AuthGate } from "./components/AuthGate";
import DashboardPage from "./pages/_index";
import SchedulePage from "./pages/escala";
import OnCallPage from "./pages/plantao";
import HolidaysPage from "./pages/feriados";
import PlanningPage from "./pages/planejamento";
import TeamsPage from "./pages/equipes";
import AbsencesPage from "./pages/ausencias";
import LockersPage from "./pages/armarios";
import TripsPage from "./pages/viagens";
import TvPage from "./pages/tv";
import MotorPage from "./pages/motor";
import StockPage from "./pages/estoque";
import AccessPage from "./pages/acessos";
import { useProfile } from "./helpers/profile";

const pages = [
  { path: "/", element: <DashboardPage /> },
  { path: "/escala", element: <SchedulePage /> },
  { path: "/plantao", element: <OnCallPage /> },
  { path: "/motor", element: <MotorPage /> },
  { path: "/feriados", element: <HolidaysPage /> },
  { path: "/planejamento", element: <PlanningPage /> },
  { path: "/equipes", element: <TeamsPage /> },
  { path: "/ausencias", element: <AbsencesPage /> },
  { path: "/viagens", element: <TripsPage /> },
  { path: "/armarios", element: <LockersPage /> },
  { path: "/estoque", element: <StockPage /> },
  { path: "/acessos", element: <AccessPage /> },
];

/** Supervisor vê tudo; supervisor de almoxarifado só a conferência de estoque. */
const AppRoutes = () => {
  const { role } = useProfile();
  if (role === "almoxarifado") {
    return (
      <Routes>
        <Route path="/estoque" element={<AppShell><StockPage /></AppShell>} />
        <Route path="*" element={<Navigate to="/estoque" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      {pages.map((p) => (
        <Route key={p.path} path={p.path} element={<AppShell>{p.element}</AppShell>} />
      ))}
      {/* modo TV fica fora do menu lateral, em tela cheia */}
      <Route path="/tv" element={<TvPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

// HashRouter: as rotas ficam depois do "#", o que funciona abrindo o index.html direto do disco (Electron)
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <GlobalContextProviders>
        <AuthGate>
          <AppRoutes />
        </AuthGate>
      </GlobalContextProviders>
    </HashRouter>
  </StrictMode>,
);
