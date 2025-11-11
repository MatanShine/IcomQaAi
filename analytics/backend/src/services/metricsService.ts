import { fetchSummaryMetrics, fetchRecentSessions, fetchAllSessions, fetchThemeUsageStats, fetchHourlyMetrics, fetchUsersByTheme, SummaryFilters } from '../db/queries';

export const getSummaryMetrics = async (filters: SummaryFilters) => fetchSummaryMetrics(filters);

export const getRecentSessions = async (filters: SummaryFilters) => fetchRecentSessions(filters);

export const getAllSessions = async (filters: SummaryFilters) => fetchAllSessions(filters);

export const getThemeUsageStats = async (filters: SummaryFilters) => fetchThemeUsageStats(filters);

export const getHourlyMetrics = async (filters: SummaryFilters & { timeRange?: string }) => fetchHourlyMetrics(filters);

export const getUsersByTheme = async (theme: string, filters: SummaryFilters) => fetchUsersByTheme(theme, filters);
