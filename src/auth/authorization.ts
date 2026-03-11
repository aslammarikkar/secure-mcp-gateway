import { trace, SpanStatusCode } from '@opentelemetry/api';

// Define roles and permissions
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  READONLY = 'readonly'
}

export enum Permission {
  SEARCH_KNOWLEDGE = 'search:knowledge',
  READ_KNOWLEDGE = 'read:knowledge',
  READ_PROFILE = 'read:profile',
  LIST_TOOLS = 'list:tools',
  CALL_TOOLS = 'call:tools'
}

// Role-permission mapping
const rolePermissions: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: [
    Permission.SEARCH_KNOWLEDGE,
    Permission.READ_KNOWLEDGE,
    Permission.READ_PROFILE,
    Permission.LIST_TOOLS,
    Permission.CALL_TOOLS
  ],
  [UserRole.USER]: [
    Permission.SEARCH_KNOWLEDGE,
    Permission.READ_KNOWLEDGE,
    Permission.READ_PROFILE,
    Permission.LIST_TOOLS,
    Permission.CALL_TOOLS
  ],
  [UserRole.READONLY]: [
    Permission.SEARCH_KNOWLEDGE,
    Permission.READ_PROFILE,
    Permission.LIST_TOOLS
  ]
};

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  permissions?: Permission[];
  iat?: number;
  exp?: number;
}

export function getUserPermissions(role: UserRole): Permission[] {
  return rolePermissions[role] || [];
}

export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  const tracer = trace.getTracer('authorization');
  const span = tracer.startSpan('authorization.hasPermission', {
    attributes: {
      'user.id': user.id,
      'user.role': user.role,
      'user.email': user.email || 'unknown',
      'permission.requested': permission,
      'user.has_custom_permissions': !!(user.permissions && user.permissions.length > 0),
    }
  });
  
  try {
    const userPermissions = user.permissions || getUserPermissions(user.role);
    const result = userPermissions.includes(permission);
    
    span.setAttributes({
      'auth.result': result,
      'user.total_permissions': userPermissions.length,
      'user.permissions': userPermissions.join(','),
    });
    
    if (result) {
      span.addEvent('authorization.permission_granted', {
        'user.id': user.id,
        'permission': permission,
      });
      span.setStatus({
        code: SpanStatusCode.OK,
        message: 'Permission granted',
      });
    } else {
      span.addEvent('authorization.permission_denied', {
        'user.id': user.id,
        'permission': permission,
        'user.permissions': userPermissions.join(','),
      });
      span.setStatus({
        code: SpanStatusCode.OK,
        message: 'Permission denied',
      });
    }
    
    return result;
  } catch (error) {
    span.addEvent('authorization.permission_check_error', {
      'error.message': error instanceof Error ? error.message : String(error),
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    span.end();
  }
}
