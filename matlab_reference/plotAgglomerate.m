function [ h, e ] = plotAgglomerate( part, evolvingSphere )

% -----------------------------------------------------------------------------------------------------------------
% [ h, e ] = plotAgglomerate( part, evolvingSphere )
%
% Plots the agglomerate along with the evolving Sphere
% 
% Input data:
% part:             Matrix with centres and radius of particles composing the
%                   agglomerate.
% evolvingSphere:   Matriz with centres and radius of the evolving Sphere
%                   for each step of the agglomerate composition
%
% Output data:
% h:                Handles to the particles
% e:                Handles to the evolving Spheres
%
% -----------------------------------------------------------------------------------------------------------------

%% Adapt function to plot tunable agglomerates
if iscell( part )
    part = cell2mat( part );
    part = part( : , 3 : end );
else
    [~,b] = size(part);
    if b == 6
        part = part( : , 3 : end );
    end
end

% For plotting particles
n = 30;     % Number of point for the meshgrid for the sphere
[ X, Y, Z ] = sphere( n );
nop = size( part, 1 );

% Vector of handles
h = zeros( nop, 1 );
e = zeros( nop, 1 );

% close all; Juan Manuel: puesto como comentario para la interfaz
hold on;
axis equal;

if nargin == 2
    for k = 1 : nop
        h( k ) = surf( part( k, 4 ) * X + part( k, 1 ), part( k, 4 ) * Y + part( k, 2 ),...
            part( k, 4 ) * Z + part( k, 3 ) );        
    end
    if iscell( evolvingSphere )
        diamEnvolvente = evolvingSphere{ 1 }{ 2 }( 1, 4 );
        xEnvolv = evolvingSphere{ 1 }{ 2 }( 1, 1 );
        yEnvolv = evolvingSphere{ 1 }{ 2 }( 1, 2 );
        zEnvolv = evolvingSphere{ 1 }{ 2 }( 1, 3 );
    else
        diamEnvolvente = evolvingSphere( 1, 4 );
        xEnvolv = evolvingSphere( 1, 1 );
        yEnvolv = evolvingSphere( 1, 2 );
        zEnvolv = evolvingSphere( 1, 3 );
    end
    e = surf( diamEnvolvente * X + xEnvolv, diamEnvolvente * Y + ...
            yEnvolv, diamEnvolvente * Z + zEnvolv );
    % To see through the last evolving sphere
    set( e, 'FaceAlpha', 0 );
elseif nargin == 1
    for k = 1 : nop
        h( k ) = surf( part( k, 4 ) * X + part( k, 1 ), part( k, 4 ) * Y + part( k, 2 ),...
            part( k, 4 ) * Z + part( k, 3 ) );
    end
end
grid;
% [ ~, ~, alpha, beta, gamma ] = determineAngles( 1 ); % Para que no lo rote una vez se genera la interfaz
% view( [ alpha beta gamma ] );