import { ReactNode } from "react";
import styles from "./PageHeader.module.css";

interface Props {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export const PageHeader = ({ eyebrow, title, description, actions, className }: Props) => (
  <header className={`${styles.header} ${className ?? ""}`}>
    <div className={styles.text}>
      {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
      <h1 className={styles.title}>{title}</h1>
      {description && <p className={styles.description}>{description}</p>}
    </div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </header>
);
