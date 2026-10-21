import { useQuery } from "@tanstack/react-query";
import { getData } from "./api";

export const APP_DATA_QUERY_KEY = ["appData"] as const;

/** Carrega equipes, técnicos, ausências, configurações, escalas, plantões e feriados de uma vez. */
export function useAppData() {
  return useQuery({
    queryKey: APP_DATA_QUERY_KEY,
    queryFn: () => getData(),
    placeholderData: (prev) => prev,
  });
}
