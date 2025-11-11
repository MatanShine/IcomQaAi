import { fetchSummaryMetrics, fetchRecentSessions, SummaryFilters } from '../db/queries';

export const getSummaryMetrics = async (filters: SummaryFilters) => fetchSummaryMetrics(filters);

export const getRecentSessions = async (filters: SummaryFilters) => fetchRecentSessions(filters);
