import { Router } from 'express';
import { createEmployeeSchema, listEmployeesQuery } from './employee.schemas.ts';
import type { EmployeesService } from './employees.service.ts';

export function employeeRoutes(employees: EmployeesService) {
  const routes = Router();

  routes.get('/employees/filter-options', async (_req, res) => {
    res.json(await employees.filterOptions());
  });

  routes.get('/employees', async (req, res) => {
    res.json(await employees.list(listEmployeesQuery.parse(req.query)));
  });

  routes.post('/employees', async (req, res) => {
    const input = createEmployeeSchema.parse(req.body);
    res.status(201).json(await employees.create(input, req.user!));
  });

  return routes;
}
