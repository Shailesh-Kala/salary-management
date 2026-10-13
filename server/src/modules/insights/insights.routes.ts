import { Router } from 'express';
import { insightsQuery, jobTitleQuery, outliersQuery } from './insights.schemas.ts';
import type { InsightsService } from './insights.service.ts';

export function insightRoutes(insights: InsightsService) {
  const routes = Router();

  routes.get('/insights/summary', async (req, res) => {
    res.json(await insights.summary(insightsQuery.parse(req.query)));
  });

  routes.get('/insights/by-country', async (req, res) => {
    res.json(await insights.byCountry(insightsQuery.parse(req.query)));
  });

  routes.get('/insights/by-department', async (req, res) => {
    res.json(await insights.byDepartment(insightsQuery.parse(req.query)));
  });

  routes.get('/insights/by-job-title', async (req, res) => {
    res.json(await insights.byJobTitle(jobTitleQuery.parse(req.query)));
  });

  routes.get('/insights/outliers', async (req, res) => {
    res.json(await insights.outliers(outliersQuery.parse(req.query)));
  });

  return routes;
}
