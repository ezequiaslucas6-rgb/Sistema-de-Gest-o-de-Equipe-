import { createContext, useContext } from "react";

export type Role = "supervisor" | "almoxarifado" | "tecnico";

export interface Profile {
  role: Role;
  name: string | null;
  email: string;
  /** técnico ligado ao login (perfil "tecnico") */
  technicianId: number | null;
}

export const ProfileContext = createContext<Profile>({ role: "supervisor", name: null, email: "", technicianId: null });

/** Perfil do usuário logado (vem de escala_usuarios). */
export const useProfile = () => useContext(ProfileContext);
