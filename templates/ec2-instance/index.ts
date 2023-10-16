import * as aws from "@pulumi/aws";
import * as aws_route53 from "@pulumi/aws/route53";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";

// Get some configuration values or set default values
const config = new pulumi.Config();
const instanceType = config.get("instanceType") || "m6g.micro";
const vpcNetworkCidr = config.get("vpcNetworkCidr") || "10.0.0.0/16";
const region = config.get("region") || "us-west-2";

// Look up the latest Amazon Linux 2 AMI for ARM
const ami = aws.ec2
  .getAmi({
    filters: [
      {
        name: "name",
        values: ["AMI"],
      },
    ],
    owners: ["amazon"],
    mostRecent: true,
  })
  .then((invoke) => invoke.id);

// Create ECR Repo for docker image
const ecrRepo = new aws.ecr.Repository(
  "web",
  {},
  { protect: true }
);

// Build and push docker image to ECR
const imageWeb = new awsx.ecr.Image(
  "web-image",
  {
    repositoryUrl: ecrRepo.repositoryUrl,
    dockerfile: "../.docker/next.Dockerfile",
    path: "../",
    args: {
      NEXT_PUBLIC_CLIENTVAR: "clientvar",
      SERVICE_NAME: "web",
      WORKSPACE: "web",
    },
    env: {},
  },
  { protect: true }
);

// User data to start a Next.js image in the EC2 instance
const userData = `#!/bin/bash
sudo su
yum update -y
yum install -y nginx
yum install -y docker
service docker start
usermod -a -G docker ec2-user
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin 11111111.dkr.ecr.${region}.amazonaws.com
docker pull ${ecrRepo.repositoryUrl}:latest
docker run -d -p 3000:3000 ${ecrRepo.repositoryUrl}:latest
`;

// Create VPC.
const vpc = new aws.ec2.Vpc("vpc", {
  cidrBlock: vpcNetworkCidr,
  enableDnsHostnames: true,
  enableDnsSupport: true,
});

// Create a subnet that automatically assigns new instances a public IP address.
const publicSubnet = new aws.ec2.Subnet("public-subnet", {
  vpcId: vpc.id,
  availabilityZone: "us-west-2a",
  cidrBlock: "172.33.0.0/24",
  mapPublicIpOnLaunch: true,
});

// Create an internet gateway.
const gateway = new aws.ec2.InternetGateway("gateway", { vpcId: vpc.id });

// Create a route table.
const routeTable = new aws.ec2.RouteTable("routeTable", {
  vpcId: vpc.id,
  routes: [
    {
      cidrBlock: "0.0.0.0/0",
      gatewayId: gateway.id,
    },
  ],
});

// Associate the route table with the public subnet.
const routeTableAssociation = new aws.ec2.RouteTableAssociation(
  "routeTableAssociation",
  {
    subnetId: publicSubnet.id,
    routeTableId: routeTable.id,
  }
);

// For SSH access when debugging
// Loading an existing public key
let publicKey = fs.readFileSync("./id_rsa.pub", "utf-8");

// Create a new Key Pair
const keyPair = new aws.ec2.KeyPair("myKeyPair", {
  publicKey: publicKey,
});

// Create a security group allowing inbound access over port 80 and outbound
// access to anywhere.
const secGroup = new aws.ec2.SecurityGroup("secGroup", {
  description: "Enable HTTP access",
  vpcId: vpc.id,
  ingress: [
    {
      fromPort: 80,
      toPort: 80,
      protocol: "tcp",
      cidrBlocks: ["0.0.0.0/0"],
    },
    {
      fromPort: 443,
      toPort: 443,
      protocol: "tcp",
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  egress: [
    {
      fromPort: 0,
      toPort: 0,
      protocol: "-1",
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

// Allow SSH inbound traffic from trusted IPs
const mySecurityGroupRule = new aws.ec2.SecurityGroupRule(
  "mySecurityGroupRule",
  {
    type: "ingress",
    fromPort: 22,
    toPort: 22,
    protocol: "tcp",
    securityGroupId: secGroup.id,
    cidrBlocks: ["myIP"],
  }
);

// A trust policy specifies who can assume the role.
let trustPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: {
        Service: "ec2.amazonaws.com",
      },
      Action: "sts:AssumeRole",
    },
  ],
};

// Creation of IAM Role for EC2.
let ec2InstanceRole = new aws.iam.Role("ec2InstanceRole", {
  assumeRolePolicy: JSON.stringify(trustPolicy),
});

// Your custom IAM policy.
let customPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "AllowAll",
      Effect: "Allow",
      Action: [
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetAuthorizationToken",
      ],
      Resource: "*",
    },
  ],
};

// Attach the policy to the role.
new aws.iam.RolePolicy("rolePolicy", {
  role: ec2InstanceRole.name,
  policy: JSON.stringify(customPolicy),
});

new aws.iam.RolePolicyAttachment("rolePolicyAttachment", {
  role: ec2InstanceRole.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess",
});

// IAM ECR Repo policy to allow pulling and pushing
new aws.ecr.RepositoryPolicy("web-repo-policy", {
  repository: ecrRepo.name,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "",
        Effect: "Allow",
        Principal: "*",
        Action: [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
        ],
      },
    ],
  }),
});

// Creation of Instance Profile to hold the IAM role.
let ec2InstanceProfile = new aws.iam.InstanceProfile("ec2InstanceProfile", {
  role: ec2InstanceRole.name,
});

// Create and launch an EC2 instance into the public subnet.
const server = new aws.ec2.Instance("server", {
  instanceType: instanceType,
  subnetId: publicSubnet.id,
  vpcSecurityGroupIds: [secGroup.id],
  userData: userData,
  keyName: keyPair.keyName,
  iamInstanceProfile: ec2InstanceProfile.name,
  ami: ami,
});

// Create am elatic ip to be used by vpc
const eip = new aws.ec2.Eip("web-ip", { instance: server.id });

// Get your hosted zone, replace "myhostedzone.com" with your actual zone
const myHostedZone = aws_route53.getZone(
  { name: "testsite.com" },
  { async: true }
);

// Create a record within the above hosted zone
const eipAliasRecord = new aws_route53.Record("record", {
  name: "",
  zoneId: myHostedZone.then((zone) => zone.zoneId),
  type: "A",
  ttl: 300,
  records: [eip.publicIp],
});

// Export the instance's publicly accessible IP address and hostname.
export const ip = eip.publicIp;
export const hostname = server.publicDns;
export const serverUrl = pulumi.interpolate`http://${server.publicDns}`;
