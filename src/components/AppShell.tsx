import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, CalendarRange, Wand2, Users, CalendarOff, RadioTower, Siren, PartyPopper, LogOut } from "lucide-react";
import { ThemeModeSwitch } from "./ThemeModeSwitch";
import { Button } from "./Button";
import { supabase } from "../helpers/supabase";
import styles from "./AppShell.module.css";

const NAV = [
  { to: "/", label: "Painel", icon: LayoutDashboard, end: true },
  { to: "/escala", label: "Escala", icon: CalendarRange },
  { to: "/plantao", label: "Plantões", icon: Siren },
  { to: "/feriados", label: "Feriados", icon: PartyPopper },
  { to: "/planejamento", label: "Planejamento 6x1 → 5x2", icon: Wand2 },
  { to: "/equipes", label: "Equipes e duplas", icon: Users },
  { to: "/ausencias", label: "Ausências", icon: CalendarOff },
];

export const AppShell = ({ children, className }: { children: ReactNode; className?: string }) => {
  return (
    <div className={`${styles.shell} ${className ?? ""}`}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <RadioTower className={styles.brandIcon} />
          <div>
            <div className={styles.brandTitle}>Escala Técnica</div>
            <div className={styles.brandSub}>Suporte · Backbone</div>
          </div>
        </div>
        <nav className={styles.nav}>
          {NAV.map((item) => (
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
          <Button
            variant="ghost"
            size="icon-md"
            className={styles.theme}
            onClick={() => supabase.auth.signOut()}
            aria-label="Sair"
            title="Sair"
          >
            <LogOut size={18} />
          </Button>
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
};
