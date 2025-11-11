import { fetchSummaryMetrics, fetchIdkSessions, SummaryFilters } from '../db/queries';

export const getSummaryMetrics = async (filters: SummaryFilters) => fetchSummaryMetrics(filters);

export const getIdkSessions = async () => fetchIdkSessions();
