# pulumi-aws - Infrastructure as Code Repo

AWS IaC using Pulumi and contains all common infrastructure for networking, clusters, IAM etc. Will also be where templates for other types of infrastructure exist.

## Folder Structure

### Common

Contains the common infra used by AWS infra

### Templates

Contains Pulumi projects that are WIPs and are other ways to deploy applications such as a static site through S3 or a single EC2 instance deployment

## How to use Pulumi

Pulumi enables developers to deploy infrastructure in any cloud environment with one common approach. Leverage familiar languages to make the most of abstractions.


To create, update or remove objects and services run `pulumi up`. Check the preview to see what changes will be made and follow the appropriate responses.

### Things to note

The common folder contains infra that is running both client apps and our own website. Be careful if/when making changes to anything that might be shared. Create copies if testing or unsure about more changes.

**Do not run `pulumi destory` or unprotect resources unless sure about what it will do**

### Resources

[Pulumi Docs](https://www.pulumi.com/docs/)

[AWS Pulumi Docs](https://www.pulumi.com/docs/clouds/aws/)

[Pulumi AI](https://www.pulumi.com/ai)
