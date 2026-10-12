import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth/RequireAuth.tsx';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage.tsx';
import { EmployeeFormPage } from './pages/EmployeeFormPage.tsx';
import { EmployeesPage } from './pages/EmployeesPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/employees" element={<EmployeesPage />} />
        <Route path="/employees/new" element={<EmployeeFormPage />} />
        <Route path="/employees/:id" element={<EmployeeDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/employees" replace />} />
    </Routes>
  );
}
