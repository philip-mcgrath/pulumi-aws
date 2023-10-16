import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const env = config.get("env");
const albName = config.get("alb");
const clusterName = config.get("cluster") || "test-cluster";
const listenerArn = config.get("enlistenerv");
const certArn =
  config.get("cert") ||
  "arn:aws:acm:us-west-2:testcrt";
const NEXT_PUBLIC_API_URL =
  config.get("NEXT_PUBLIC_API_URL") || "http://localhost:3000/api";
const url = config.get("url");
const rulePriority = +(
  config.get("rulePriority") || Math.floor(Math.random() * 200) + 1
);

// Get common infra

const vpc = aws.ec2.getVpcOutput({ id: "vpc" });
const alb = aws.lb.getLoadBalancerOutput({ name: albName });
const cluster = aws.ecs.getClusterOutput({ clusterName: clusterName });
const listener443 = aws.lb.getListenerOutput({
  arn: listenerArn,
  loadBalancerArn: alb.arn,
  port: 443,
});

// ## SITE ## //

const testHZ = new aws.route53.Zone(
  `test-${env}-zone`,
  { name: url },
  { protect: true }
);

// Create DNS record in the hosted zone
const albARecord = new aws.route53.Record(
  `${env}-a-test`,
  {
    zoneId: testHZ.zoneId,
    name: "",
    type: "A",
    aliases: [
      {
        evaluateTargetHealth: true,
        name: alb.dnsName,
        zoneId: alb.zoneId,
      },
    ],
  },
  { protect: true }
);

// Create ECR Repo for docker image
const testRepo = new aws.ecr.Repository(
  `test-web-${env}`,
  {
    tags: {
      Client: "test",
      Name: `test ${env} Web Repo`,
    },
  },
  { protect: true }
);

const testImageWebDev = new awsx.ecr.Image(
  `test-web-${env}-image`,
  {
    repositoryUrl: testRepo.repositoryUrl,
    dockerfile: `../../../.docker/next.${env}.Dockerfile`,
    path: "../../../",
    args: {
      NEXT_PUBLIC_CLIENTVAR: "clientvar",
      SERVICE_NAME: "web",
      WORKSPACE: "web",
    },
    env: {
      NEXT_PUBLIC_NODE_ENV: "production",
      NEXT_PUBLIC_PORT: "3000",
      NEXT_PUBLIC_API_URL: NEXT_PUBLIC_API_URL,
    },
  },
  { protect: true }
);

const testTargetGroup = new aws.lb.TargetGroup(
  `test-${env}-tg`,
  {
    port: 80,
    protocol: "HTTP",
    targetType: "instance",
    vpcId: vpc.id,
    tags: {
      Client: "test",
      Name: `test Web ${env} Target Group`,
    },
  },
  { protect: true }
);

const testListenerCert = new aws.alb.ListenerCertificate(
  `test-${env}-cert`,
  {
    listenerArn: listener443.arn,
    certificateArn: certArn,
  }
);

const testRule = new aws.lb.ListenerRule(
  `test-${env}-rule`,
  {
    actions: [
      {
        type: "forward",
        targetGroupArn: testTargetGroup.arn,
      },
    ],
    conditions: [
      {
        hostHeader: {
          values: [`test.${env}.com`],
        },
      },
    ],
    listenerArn: listener443.arn,
    priority: rulePriority,
    tags: {
      Client: "test",
      Name: `test Web ${env} Rule`,
    },
  },
  { protect: true }
);

// Create an ECS task definition for EC2 launch type
const testTaskDefinition = new awsx.ecs.EC2TaskDefinition(
  `test-web-${env}`,
  {
    containers: {
      app: {
        name: "app",
        image: testImageWebDev.imageUri,
        cpu: 0,
        portMappings: [
          {
            containerPort: 3000,
            hostPort: 0,
            protocol: "tcp",
          },
        ],
        essential: true,
        environment: [],
        mountPoints: [],
        volumesFrom: [],
        secrets: [],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            // FIXME: Logs should get created here
            "awslogs-create-group": "true",
            "awslogs-group": `/ecs/test-web-${env}`,
            "awslogs-region": "us-west-2",
            "awslogs-stream-prefix": "ecs",
          },
        },
      },
    },
    taskRole: {
      roleArn: "arn:aws:iam::Role",
    },
    executionRole: {
      roleArn: "arn:aws:iam::Role",
    },
    family: `test-${env}`,
    networkMode: "bridge",
    cpu: "128",
    memory: "256",
    tags: {
      Client: "test",
      Name: `test Web ${env} Task`,
    },
  }
);

// Create an ECS service, running on the previously created cluster
const testService = new awsx.ecs.EC2Service(`test-web-${env}`, {
  cluster: cluster.arn,
  taskDefinition: testTaskDefinition.taskDefinition.family,
  propagateTags: "TASK_DEFINITION",
  desiredCount: 1,
  enableEcsManagedTags: true,
  continueBeforeSteadyState: true,
  deploymentCircuitBreaker: {
    enable: true,
    rollback: true,
  },
  loadBalancers: [
    {
      targetGroupArn: testTargetGroup.arn,
      containerName: "app",
      containerPort: 3000,
    },
  ],
});