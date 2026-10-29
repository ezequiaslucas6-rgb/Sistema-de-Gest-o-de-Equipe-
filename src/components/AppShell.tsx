import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, CalendarRange, Wand2, Users, CalendarOff, Siren, PartyPopper, LockKeyhole, Plane, Cpu, PackageCheck, KeyRound } from "lucide-react";
import { useProfile } from "../helpers/profile";
import { ThemeModeSwitch } from "./ThemeModeSwitch";
import { DatabaseMenu } from "./DatabaseMenu";
import styles from "./AppShell.module.css";

const NAV = [
  { to: "/", label: "Painel", icon: LayoutDashboard, end: true },
  { to: "/escala", label: "Escala", icon: CalendarRange },
  { to: "/motor", label: "Escala de plantão", icon: Siren },
  { to: "/plantao", label: "Regras e banco de horas", icon: Cpu },
  { to: "/feriados", label: "Feriados", icon: PartyPopper },
  { to: "/viagens", label: "Viagens e diárias", icon: Plane },
  { to: "/planejamento", label: "Planejamento 6x1 → 5x2", icon: Wand2 },
  { to: "/equipes", label: "Equipes e duplas", icon: Users },
  { to: "/ausencias", label: "Ausências", icon: CalendarOff },
  { to: "/armarios", label: "Armários", icon: LockKeyhole },
  { to: "/estoque", label: "Conferência de estoque", icon: PackageCheck },
  { to: "/acessos", label: "Acessos", icon: KeyRound },
];

/** O supervisor de almoxarifado só vê a conferência de estoque. */
const STOCK_ONLY = new Set(["/estoque"]);

export const AppShell = ({ children, className }: { children: ReactNode; className?: string }) => {
  const { role } = useProfile();
  const nav = role === "almoxarifado" ? NAV.filter((n) => STOCK_ONLY.has(n.to)) : NAV;
  return (
    <div className={`${styles.shell} ${className ?? ""}`}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src="./logo.png" alt="" className={styles.brandIcon} />
          <div>
            <div className={styles.brandTitle}>Escala Técnica</div>
            <div className={styles.brandSub}>{role === "almoxarifado" ? "Almoxarifado" : "Suporte · Backbone"}</div>
          </div>
        </div>
        <nav className={styles.nav}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ""}`}
            >
              <item.icon className={styles.navIcon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <ThemeModeSwitch className={styles.theme} />
          <DatabaseMenu className={styles.theme} />
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
};
