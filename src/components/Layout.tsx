import { NavLink, Outlet } from "react-router-dom";
import { lowStock } from "../lib/analytics";
import { useStore } from "../store/store";

export function Layout() {
  const { data, persisted } = useStore();
  const inShop = data.jobs.filter((j) => j.status === "In progress" || j.status === "Waiting parts" || j.status === "Ready").length;
  const low = lowStock(data).length;
  const unpaid = data.jobs.filter((j) => j.invoice && !j.invoice.paidAt).length;
  return (
    <div className="admin-shell">
      <aside className="admin-side" aria-label="Main menu">
        <NavLink to="/" end className="logo" style={{ padding: "0.2rem 0.5rem 0.8rem" }}>
          <img src="./favicon.svg" alt="" width={30} height={30} />
          <span>{data.settings.name}</span>
        </NavLink>
        <NavLink to="/" end className="side-link">
          Workshop board {inShop > 0 && <span className="badge count">{inShop}</span>}
        </NavLink>
        <NavLink to="/jobs" className="side-link">
          Job cards {unpaid > 0 && <span className="badge badge-warn count">{unpaid} unpaid</span>}
        </NavLink>
        <NavLink to="/customers" className="side-link">
          Customers
        </NavLink>
        <NavLink to="/parts" className="side-link">
          Parts {low > 0 && <span className="badge badge-bad count">{low} low</span>}
        </NavLink>
        <NavLink to="/reports" className="side-link">
          Reports
        </NavLink>
        <NavLink to="/settings" className="side-link">
          Settings
        </NavLink>
        <div className="side-extra muted small" style={{ marginTop: "auto", padding: "0.5rem" }}>
          Demo mode: data is stored in this browser only.
        </div>
      </aside>
      <main className="admin-main">
        {!persisted && (
          <div className="notice no-print" role="alert" style={{ marginBottom: "1rem" }}>
            Your browser blocked local storage, so changes will be lost when you close this tab.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
