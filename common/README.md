# Common Infrastructure

This folder contains the commone infra used by AWS resources

## Networking & Routing

- VPC config including 3 availibility zones each containing a private and public subnet. The VPC also contains a internet gatewat and natgateway
- An Applicaiton Load Balancer with listeners on ports 80 (HTTP) and 443 (HTTPS)
- More load balancers can be added as needed for clients
- Default SSL cert for intergalactic.com

## IAM & Security

- A public key for connecting to instances
- Security groups for default use and the Application Load Balancer
- IAM Roles, Policies and Permissions for running an ECS Cluster and ECR repo

## ECS

- The shared ECS cluster which is used for all dev, staging and production envs
- A capacity provider, auto-scaling group and a launch template for the EC2 isntances that are run in the cluster. This provides configuration for the cluster to scale as needed