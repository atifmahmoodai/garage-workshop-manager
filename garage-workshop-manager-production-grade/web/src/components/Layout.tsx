import { Suspense } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { isDesk, useLogout, useMe, useMeta } from "../api/auth";
import { errorText } from "../api/client";

export function Layout() {
  const me = useMe();
  const meta = useMeta(!!me.data);
  const logout = useLogout();
  const location = useLocation();

  if (me.isPending) return <p className="muted" style={{ padding: "2rem" }}>Loading…</p>;
  if (me.isError) return <p className="field-error" style={{ padding: "2rem" }}>{errorText(me.error)}</p>;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (meta.isPending) return <p className="muted" style={{ padding: "2rem" }}>Loading…</p>;
  if (meta.isError) {
    return (
      <div className="card empty" style={{ margin: "2rem" }}>
        <h1>Couldn't load the workshop</h1>
        <p className="muted">{errorText(meta.error)}</p>
        <button className="btn btn-primary" onClick={() => void meta.refetch()}>
          Retry
        </button>
      </div>
    );
  }
  const { settings, counts } = meta.data;
  const user = me.data;
  const desk = isDesk(user);

  return (
    <div className="admin-shell">
      <aside className="admin-side no-print" aria-label="Main menu">
        <NavLink to="/" end className="logo" style={{ padding: "0.2rem 0.5rem 0.8rem" }}>
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <span>{settings.name}</span>
        </NavLink>
        <NavLink to="/" end className="side-link">
          Workshop board {counts.inShop > 0 && <span className="badge count">{counts.inShop}</span>}
        </NavLink>
        <NavLink to="/jobs" className="side-link">
          Job cards {counts.unpaid > 0 && <span className="badge badge-warn count">{counts.unpaid} unpaid</span>}
        </NavLink>
        <NavLink to="/customers" className="side-link">
          Customers
        </NavLink>
        <NavLink to="/parts" className="side-link">
          Parts {counts.lowStock > 0 && <span className="badge badge-bad count">{counts.lowStock} low</span>}
        </NavLink>
        {desk && (
          <NavLink to="/reports" className="side-link">
            Reports
          </NavLink>
        )}
        {user.role === "admin" && (
          <>
            <NavLink to="/settings" className="side-link">
              Settings &amp; users
            </NavLink>
            <NavLink to="/audit" className="side-link">
              Activity log
            </NavLink>
          </>
        )}
        <div className="side-extra side-user small" style={{ marginTop: "auto" }}>
          <div>
            <strong>{user.name}</strong> <span className="muted">({user.role})</span>
          </div>
          <div className="row" style={{ gap: "0.4rem", marginTop: "0.4rem" }}>
            <NavLink to="/account" className="btn btn-sm">
              My account
            </NavLink>
            <button className="btn btn-sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="admin-main">
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
