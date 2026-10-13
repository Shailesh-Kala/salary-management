import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth/RequireAuth.tsx';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage.tsx';
import { EmployeeFormPage } from './pages/EmployeeFormPage.tsx';
import { EmployeesPage } from './pages/EmployeesPage.tsx';
import { ExchangeRatesPage } from './pages/ExchangeRatesPage.tsx';
import { ExportDownloadPage } from './pages/ExportDownloadPage.tsx';
import { ExportsPage } from './pages/ExportsPage.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { ImportsPage } from './pages/ImportsPage.tsx';
import { InsightsPage } from './pages/InsightsPage.tsx';
import { SlipPage } from './pages/SlipPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/new" element={<EmployeeFormPage />} />
        <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        <Route path="/employees/:id/slip" element={<SlipPage />} />
        <Route path="/exchange-rates" element={<ExchangeRatesPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/exports" element={<ExportsPage />} />
        <Route path="/exports/:id" element={<ExportDownloadPage />} />
        <Route path="/imports" element={<ImportsPage />} />
        <Route path="/imports/:id" element={<ImportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/employees" replace />} />
    </Routes>
  );
}
