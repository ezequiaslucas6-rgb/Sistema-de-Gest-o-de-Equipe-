import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import "./base.css";
import "./global.css";
import { GlobalContextProviders } from "./components/_globalContextProviders";
import { AppShell } from "./components/AppShell";
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

const pages = [
  { path: "/", element: <DashboardPage /> },
  { path: "/escala", element: <SchedulePage /> },
  { path: "/plantao", element: <OnCallPage /> },
  { path: "/feriados", element: <HolidaysPage /> },
  { path: "/planejamento", element: <PlanningPage /> },
  { path: "/equipes", element: <TeamsPage /> },
  { path: "/ausencias", element: <AbsencesPage /> },
  { path: "/viagens", element: <TripsPage /> },
  { path: "/armarios", element: <LockersPage /> },
];

// HashRouter: as rotas ficam depois do "#", o que funciona abrindo o index.html direto do disco (Electron)
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <GlobalContextProviders>
        <Routes>
          {pages.map((p) => (
            <Route key={p.path} path={p.path} element={<AppShell>{p.element}</AppShell>} />
          ))}
          {/* modo TV fica fora do menu lateral, em tela cheia */}
          <Route path="/tv" element={<TvPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </GlobalContextProviders>
    </HashRouter>
  </StrictMode>,
);
