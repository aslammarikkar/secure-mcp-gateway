targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('Tags applied to all deployed resources')
param resourceTags object

@description('OAuth resource server URL')
param resourceServerUrl string = ''
@description('Azure Entra tenant ID')
param tenantId string = ''
@description('MCP Resource App ID (Entra app registration)')
param mcpResourceAppId string = ''
@description('MCP scope for OAuth')
param mcpScope string = 'access_as_user'
@description('Microsoft Graph scope requested during OBO exchange')
param graphOboScope string = 'https://graph.microsoft.com/User.Read'

param mcpServerIngressPort int = 3000

param mcpContainerTsExists bool

// Tags that should be applied to all resources.
// 
// Note that 'azd-service-name' tags should be applied separately to service host resources.
// Example usage:
//   tags: union(tags, { 'azd-service-name': <service name in azure.yaml> })
var tags = {
  'azd-env-name': environmentName
}

// Organize resources in a resource group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'ADA-GenAiCopilot-Demo'
  location: location
  tags: union(tags, resourceTags)
}

module resources 'resources.bicep' = {
  scope: rg
  name: 'resources'
  params: {
    location: location
    tags: resourceTags
    mcpContainerTsExists: mcpContainerTsExists
    mcpServerIngressPort: mcpServerIngressPort
    resourceServerUrl: resourceServerUrl
    tenantId: tenantId
    mcpResourceAppId: mcpResourceAppId
    mcpScope: mcpScope
    graphOboScope: graphOboScope
  }
}

// ------------------
//    OUTPUT
// ------------------
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_RESOURCE_MCP_CONTAINER_TS_ID string = resources.outputs.AZURE_RESOURCE_MCP_CONTAINER_TS_ID
output APPLICATIONINSIGHTS_CONNECTION_STRING string = resources.outputs.APPLICATIONINSIGHTS_CONNECTION_STRING
