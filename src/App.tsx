import { lazy, Suspense, useEffect } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Board } from "./pages/Board";
import { CustomerDetail } from "./pages/CustomerDetail";
import { Customers } from "./pages/Customers";
import { Invoice } from "./pages/Invoice";
import { JobEditor } from "./pages/JobEditor";
import { Jobs } from "./pages/Jobs";
import { Parts } from "./pages/Parts";
import { SettingsPage } from "./pages/Settings";
import { StoreProvider } from "./store/store";

// The charting library only loads with the reports page.
const Reports = lazy(() => import("./pages/Reports").then((m) => ({ default: m.Reports })));

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
    <StoreProvider>
      <HashRouter>
        <ScrollToTop />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Board />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/new" element={<JobEditor />} />
            <Route path="jobs/:id" element={<JobEditor />} />
            <Route path="jobs/:id/invoice" element={<Invoice />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="parts" element={<Parts />} />
            <Route
              path="reports"
              element={
                <Suspense fallback={<p className="muted">Loading…</p>}>
                  <Reports />
                </Suspense>
              }
            />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </StoreProvider>
  );
}
