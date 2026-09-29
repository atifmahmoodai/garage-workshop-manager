import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Board } from "./pages/Board";
import { CustomerDetail } from "./pages/CustomerDetail";
import { Customers } from "./pages/Customers";
import { Invoice } from "./pages/Invoice";
import { JobEditor } from "./pages/JobEditor";
import { Jobs } from "./pages/Jobs";
import { Login } from "./pages/Login";
import { Parts } from "./pages/Parts";

// Charts and admin screens load on demand.
const Reports = lazy(() => import("./pages/Reports").then((m) => ({ default: m.Reports })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const Account = lazy(() => import("./pages/Account").then((m) => ({ default: m.Account })));
const AuditLog = lazy(() => import("./pages/AuditLog").then((m) => ({ default: m.AuditLog })));

function ScrollToTop() {
  const { pathname } = useLocation();
  // Block body: newer browsers return a Promise from scrollTo, and an effect must not return it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route element={<Layout />}>
            <Route index element={<Board />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/new" element={<JobEditor />} />
            <Route path="jobs/:id" element={<JobEditor />} />
            <Route path="jobs/:id/invoice" element={<Invoice />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="parts" element={<Parts />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="account" element={<Account />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
