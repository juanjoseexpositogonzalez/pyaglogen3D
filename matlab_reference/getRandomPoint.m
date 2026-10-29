function p = getRandomPoint( part, i, delta )
%
% p = getRandomPoint( part, i, delta )
% Calculates a random point inside a cloud of points representing the
% surface of an agglomerate.
%
% Input Data:
% part:     Matrix of particles
% i:        Cluster del cual hay que calcular al punto al azar
% delta:    variable which indicates how far from the border of the
%           sphere the point will be selected (concept of delta-neighbourhood)
%
% Output Data:
% p:        Coordinates of the random point ( X, Y, Z )
%

%% Get matrix with coordinates of particles inside the aglomerate until
% iteration i. Get also the radius and get the delta-neigbourhoud ((1+delta)
% times) of the set
if iscell( part )
    part = cell2mat( part );
end

aglomerado = zeros( i, 3 );
radii = zeros( i, 3 );
for j = 1 : i
    aglomerado( j, 1 : 3 ) = part( i , 3 : 5 );
    radii( j, 1 )          = part( i, 6 ) + delta;
end

% Define resolution for sphere points calculation
% Creates ( n + 1 ) * ( n + 1 ) matrices for X, Y and Z coordinates
n = 99; 

% Create Spheres
[ Coordinates, ~ ] = createSpheres( [ aglomerado radii ] , 1, n );

% Project Coordinates
% Coordinates = ( A * Coordinates )';

Coordinates = Coordinates';

% Remove duplicate points (if any)
[ Coordinates ] = unique( Coordinates, 'rows' );

%% Get random point in the cloud
%rng( 'shuffle' );
fila = randi( size( Coordinates, 1 ) );

%% Select the point p from Coordinates matrix
%  First, get back to original representation
% Coordinates = ( A \ Coordinates' )';
p = Coordinates( fila, 1 : 3 );

end

function [ Coordinates, SphereNumbers ] = createSpheres( part, i, n )
%
% [ X, Y, Z ] = createSpheres( part, i )
% Creates the coordinates points of spheres given by the coordinates of
% their centres and diameters
%
% Input Data:
% part:             Matrix with coordinates of centres and diameters
% i:                Number of spheres so far
% n:                Resolution of every sphere
%
% Output Data:
% Coordinates:      Matrix with X, Y, Z coordinates of spheres
% SphereNumbers:    Numbers of the different spheres (1 to i)
%

%% Create X, Y, Z coordinates for a sphere
[ X, Y, Z ] = sphere( n );

%% Memory allocation
%  First we get the number of elements (coordinates) of each dimension
filas           = numel( X );
columnas        = 3; 
Coordinates     = zeros( i * filas, columnas );
SphereNumbers   = zeros( i * filas, 1 );

for j = 1 : i
    XX = part( j, 4 ) * X + part( j, 1 );
    YY = part( j, 4 ) * Y + part( j, 2 );
    ZZ = part( j, 4 ) * Z + part( j, 3 );
    XX = reshape( XX, numel( XX ), 1 );
    YY = reshape( YY, numel( YY ), 1 );
    ZZ = reshape( ZZ, numel( ZZ ), 1 );
    Coordinates( 1 + ( j - 1 ) * filas : j * filas, 1 : 3 ) = ...
        [ XX YY ZZ ];
    SphereNumbers( 1 + ( j - 1 ) * filas : j * filas, 1 ) = j;
end

%% Prepare Coordinates for transformation matrix
 Coordinates = [ Coordinates( :, : ) ones( size( Coordinates, 1 ), 1 ) ]';
 SphereNumbers = reshape( SphereNumbers, numel( SphereNumbers ), 1 );
 
end

