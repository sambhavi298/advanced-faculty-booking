import type {
  Appointment,
  AppointmentList,
  AppointmentStatus,
  AuthUser,
  AvailabilityWindow,
  CreateAppointmentRequest,
  CreateExceptionRequest,
  CreateExceptionResponse,
  FacultyAvailability,
  FacultySummary,
  LivenessResponse,
  LoginRequest,
  LoginResponse,
  MyAvailability,
  ReadinessResponse,
  ReplaceAvailabilityResponse,
} from '@afb/types';
import axios, { type AxiosInstance } from 'axios';
import { type ApiError, toApiError } from './errors';
import type { TokenStore } from './token-store';

export interface ApiClientOptions {
  tokenStore: TokenStore;
  /** Defaults to '/api' — in development the Vite server proxies it to the API. */
  baseURL?: string;
  timeoutMs?: number;
  /**
   * Called when a request that carried a token is answered with 401 (expired or revoked session).
   * The token has already been cleared; the portal typically redirects to its login page.
   */
  onSessionExpired?: (error: ApiError) => void;
}

/**
 * Creates the API client for one portal. Every request carries `Authorization: Bearer <token>` when a
 * token is stored; every failure rejects with an ApiError.
 */
export function createApiClient({
  tokenStore,
  baseURL = '/api',
  timeoutMs = 15_000,
  onSessionExpired,
}: ApiClientOptions) {
  const http: AxiosInstance = axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: { Accept: 'application/json' },
  });

  http.interceptors.request.use((config) => {
    const token = tokenStore.get();
    if (token !== null) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  http.interceptors.response.use(undefined, (err: unknown) => {
    const error = toApiError(err);
    const sentToken = axios.isAxiosError(err) && err.config?.headers.has('Authorization') === true;
    if (error.status === 401 && sentToken) {
      tokenStore.clear();
      onSessionExpired?.(error);
    }
    return Promise.reject(error);
  });

  return {
    http,

    auth: {
      /** POST /auth/login — stores the token on success. */
      async login(request: LoginRequest): Promise<LoginResponse> {
        const { data } = await http.post<LoginResponse>('/auth/login', request);
        tokenStore.set(data.token, data.expiresAt);
        return data;
      },
      /** GET /auth/me — the signed-in user. */
      async me(): Promise<AuthUser> {
        return (await http.get<AuthUser>('/auth/me')).data;
      },
      /** Tokens are stateless: signing out means forgetting the token. */
      logout(): void {
        tokenStore.clear();
      },
      isSignedIn(): boolean {
        return tokenStore.get() !== null;
      },
    },

    appointments: {
      /** POST /appointments (student) */
      async create(request: CreateAppointmentRequest): Promise<Appointment> {
        return (await http.post<Appointment>('/appointments', request)).data;
      },
      /** GET /appointments/me (student or faculty), optionally one status */
      async mine(status?: AppointmentStatus): Promise<AppointmentList> {
        return (
          await http.get<AppointmentList>('/appointments/me', {
            params: status === undefined ? {} : { status },
          })
        ).data;
      },
      /** PATCH /appointments/:id/cancel (student) */
      async cancel(id: string, reason?: string): Promise<Appointment> {
        return (await http.patch<Appointment>(`/appointments/${encodeURIComponent(id)}/cancel`, { reason }))
          .data;
      },
      /** PATCH /appointments/:id/approve (faculty) */
      async approve(id: string, note?: string): Promise<Appointment> {
        return (await http.patch<Appointment>(`/appointments/${encodeURIComponent(id)}/approve`, { note }))
          .data;
      },
      /** PATCH /appointments/:id/reject (faculty) */
      async reject(id: string, reason?: string): Promise<Appointment> {
        return (await http.patch<Appointment>(`/appointments/${encodeURIComponent(id)}/reject`, { reason }))
          .data;
      },
      /** GET /faculty/pending (faculty) */
      async pending(): Promise<Appointment[]> {
        return (await http.get<Appointment[]>('/faculty/pending')).data;
      },
    },

    faculty: {
      /** GET /faculty — directory search by name, Employee ID, department or designation */
      async list(filter: { search?: string; department?: string } = {}): Promise<FacultySummary[]> {
        return (await http.get<FacultySummary[]>('/faculty', { params: filter })).data;
      },
      /** GET /faculty/:id/availability — free slots per day (personalised for students) */
      async availability(
        id: number,
        range: { from?: string; to?: string } = {},
      ): Promise<FacultyAvailability> {
        return (await http.get<FacultyAvailability>(`/faculty/${String(id)}/availability`, { params: range }))
          .data;
      },
      /** GET /faculty/availability (faculty: own weekly windows and exceptions) */
      async myAvailability(): Promise<MyAvailability> {
        return (await http.get<MyAvailability>('/faculty/availability')).data;
      },
      /** PUT /faculty/availability (faculty: replace the weekly set) */
      async replaceAvailability(windows: AvailabilityWindow[]): Promise<ReplaceAvailabilityResponse> {
        return (await http.put<ReplaceAvailabilityResponse>('/faculty/availability', { windows })).data;
      },
      /** POST /faculty/availability/exceptions (faculty: leave, meeting, blocked time) */
      async addException(request: CreateExceptionRequest): Promise<CreateExceptionResponse> {
        return (await http.post<CreateExceptionResponse>('/faculty/availability/exceptions', request)).data;
      },
      /** DELETE /faculty/availability/exceptions/:id */
      async removeException(id: number): Promise<void> {
        await http.delete(`/faculty/availability/exceptions/${String(id)}`);
      },
    },

    health: {
      async live(): Promise<LivenessResponse> {
        return (await http.get<LivenessResponse>('/health')).data;
      },
      async ready(): Promise<ReadinessResponse> {
        return (await http.get<ReadinessResponse>('/health/ready')).data;
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
