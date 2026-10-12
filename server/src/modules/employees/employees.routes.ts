import { type Request, Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import {
  createEmployeeSchema,
  listEmployeesQuery,
  updateProfileSchema,
} from './employee.schemas.ts';
import type { EmployeesService } from './employees.service.ts';

/** A malformed id can't match any employee, so it is a 404 rather than a 400. */
function employeeId(req: Request) {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw new AppError('NOT_FOUND', 404, 'Employee not found');
  return id.data;
}

export function employeeRoutes(employees: EmployeesService) {
  const routes = Router();

  routes.get('/employees/filter-options', async (_req, res) => {
    res.json(await employees.filterOptions());
  });

  routes.get('/employees', async (req, res) => {
    res.json(await employees.list(listEmployeesQuery.parse(req.query)));
  });

  routes.get('/employees/:id', async (req, res) => {
    res.json(await employees.get(employeeId(req)));
  });

  routes.patch('/employees/:id', async (req, res) => {
    const id = employeeId(req);
    res.json(await employees.updateProfile(id, updateProfileSchema.parse(req.body)));
  });

  routes.post('/employees', async (req, res) => {
    const input = createEmployeeSchema.parse(req.body);
    res.status(201).json(await employees.create(input, req.user!));
  });

  return routes;
}
