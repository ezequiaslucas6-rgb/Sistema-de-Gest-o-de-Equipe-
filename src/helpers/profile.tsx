import { createContext, useContext } from "react";

export type Role = "supervisor" | "almoxarifado";

export interface Profile {
  role: Role;
  name: string | null;
  email: string;
}

export const ProfileContext = createContext<Profile>({ role: "supervisor", name: null, email: "" });

/** Perfil do usuário logado (vem de escala_usuarios). */
export const useProfile = () => useContext(ProfileContext);
