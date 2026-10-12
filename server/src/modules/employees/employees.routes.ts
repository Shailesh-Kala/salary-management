import { Router } from 'express';
import { createEmployeeSchema } from './employee.schemas.ts';
import type { EmployeesService } from './employees.service.ts';

export function employeeRoutes(employees: EmployeesService) {
  const routes = Router();

  routes.post('/employees', async (req, res) => {
    const input = createEmployeeSchema.parse(req.body);
    res.status(201).json(await employees.create(input, req.user!));
  });

  return routes;
}
