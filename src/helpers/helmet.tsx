import type { ReactNode } from "react";

/** Substitui o react-helmet: no React 19, <title> renderizado em qualquer lugar vai para o <head>. */
export const Helmet = ({ children }: { children?: ReactNode }) => <>{children}</>;
