import { fetchSupportRequests, SummaryFilters } from '../db/queries';

export const getSupportRequests = async (filters: SummaryFilters) => fetchSupportRequests(filters);
